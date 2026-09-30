#!/usr/bin/env python3
"""Fetch compact, auditable observations. No LLM calls; never invent missing data.
Usage: python scripts/refresh-dashboard.py --session close --market-date 2026-09-23
"""
import argparse
import concurrent.futures
import datetime as dt
import json
import math
import pathlib
import re
import subprocess
from zoneinfo import ZoneInfo
from refresh_sectors import get_sector_pulse
from market_calendar import next_update, trading_day, CONFIG
from tradingview_premarket import batch as alternative_premarket

ROOT = pathlib.Path(__file__).resolve().parents[1]
NY = ZoneInfo('America/New_York')
CN = ZoneInfo('Asia/Shanghai')
UTC = dt.timezone.utc
NAMES = {'SPY':'标普 500','QQQ':'纳斯达克 100','VIX':'波动率','RSP':'标普500等权','SPMO':'标普500动量','VIX3M':'三个月波动率', 'DRAM':'存储整体',
         'MU':'Micron','SKHY':'SK hynix','SNDK':'Sandisk','WDC':'Western Digital',
         'IREN':'IREN','NBIS':'Nebius','CRWV':'CoreWeave','SPCX':'SpaceX',
         'RKLB':'Rocket Lab','ASTS':'AST SpaceMobile','BTC':'Bitcoin','ETH':'Ethereum',
         'COIN':'Coinbase','MSTR':'Strategy','HOOD':'Robinhood'}
PROVIDER = {'VIX':'^VIX','VIX3M':'^VIX3M','BTC':'BTC-USD','ETH':'ETH-USD'}
FIRST_DATE = {'SPCX':'2026-06-12','SKHY':'2026-07-10','DRAM':'2026-04-02'}

def fetch(url):
    return subprocess.check_output(['curl','--fail','-L','-sS','--max-time','25',
        '-H','User-Agent: Mozilla/5.0','-H','Accept: application/json,text/html',url], text=True)

def get_chart(symbol, premarket=False):
    provider = PROVIDER.get(symbol, symbol)
    interval = '1m' if premarket else '30m'
    extended = 'true' if premarket else 'false'
    url = f'https://query1.finance.yahoo.com/v8/finance/chart/{provider}?interval={interval}&range=5d&includePrePost={extended}'
    attempts = []
    for host in ['query1','query2']:
        endpoint = url.replace('query1', host)
        try:
            raw = json.loads(fetch(endpoint))
            result = raw['chart']['result'][0]
            if result['meta']['symbol'].upper() != provider.upper():
                raise ValueError('Provider symbol mismatch')
            return {'result':result,'sourceUrl':endpoint,'fetchedAt':dt.datetime.now(UTC).isoformat()}
        except Exception as error:
            attempts.append({'url':endpoint,'error':str(error)[:160]})
    return {'error':'两次来源请求均失败','attempts':attempts}

def iso(timestamp):
    return dt.datetime.fromtimestamp(timestamp, UTC).isoformat()

def bars(chart, symbol):
    r = chart['result']; q = r['indicators']['quote'][0]
    output = []
    for i,t in enumerate(r.get('timestamp',[])):
        vals = {key:q.get(key,[])[i] if i < len(q.get(key,[])) else None for key in ['open','high','low','close','volume']}
        if not all(isinstance(vals[k],(float,int)) and math.isfinite(vals[k]) and vals[k] > 0 for k in ['open','high','low','close']):
            continue
        if vals['high'] < max(vals['open'],vals['close']) or vals['low'] > min(vals['open'],vals['close']):
            continue
        local = dt.datetime.fromtimestamp(t,NY)
        if local.date().isoformat() < FIRST_DATE.get(symbol,'1900-01-01'):
            continue
        # Source timestamps are bar STARTS. Terminal live/16:00 markers are not a full bar.
        if t % 1800 != 0:
            continue
        if symbol not in ['BTC','ETH','VIX','VIX3M']:
            minute = local.hour*60+local.minute
            if not 570 <= minute < 960:
                continue
        output.append({'t':t,'end':t+1800,**vals})
    return output

def observation(symbol, chart, cutoff, market_date, previous_close_at):
    empty = {'symbol':symbol,'name':NAMES[symbol],'status':'unavailable','price':None,'changePct':None,
             'asOf':None,'marketDate':market_date,'trend30m':'unknown','spark':[],
             'sourceUrl':chart.get('sourceUrl'),'note':chart.get('error','缺少同口径行情')}
    if 'result' not in chart:
        return empty
    seq = [b for b in bars(chart,symbol) if b['end'] <= cutoff]
    if not seq:
        return empty
    latest = seq[-1]
    if cutoff-latest['end'] > 1800:
        empty['note'] = '行情未覆盖目标时点；未沿用旧价'
        return empty
    baseline_bars = [b for b in seq if b['end'] <= previous_close_at]
    if not baseline_bars or previous_close_at-baseline_bars[-1]['end'] > 1800:
        return empty
    base = baseline_bars[-1]
    # Intraday observations use the same regular-session baseline, including crypto.
    day_open = dt.datetime.fromisoformat(market_date+'T09:30:00').replace(tzinfo=NY).timestamp()
    today = [b for b in seq if day_open <= b['t'] and b['end'] <= cutoff]
    if not today:
        return empty
    closes = [b['close'] for b in seq]
    ema = closes[0]; ema_before = None
    for c in closes[1:]:
        ema_before = ema
        ema += 2/21*(c-ema)
    enough = len(closes) >= 25
    slope = (ema/ema_before-1)*100 if ema_before else 0
    trend = 'up' if enough and latest['close'] > ema and slope > 0 else 'down' if enough and latest['close'] < ema and slope < 0 else 'mixed' if enough else 'unknown'
    vol = sum(b['volume'] or 0 for b in today)
    vwap = sum((b['high']+b['low']+b['close'])/3*(b['volume'] or 0) for b in today)/vol if vol > 0 and symbol not in ['VIX','VIX3M','BTC','ETH'] else None
    price, baseline = latest['close'], base['close']
    meta = chart['result']['meta']
    terminal = meta.get('regularMarketTime',0)
    # Include the closing auction when Yahoo exposes a verified same-day final quote.
    if symbol not in ['BTC','ETH','VIX','VIX3M'] and dt.datetime.fromtimestamp(terminal,NY).date().isoformat()==market_date:
        if cutoff == terminal and meta.get('regularMarketPrice',0)>0:
            price = meta['regularMarketPrice']
        if meta.get('previousClose',0)>0:
            baseline = meta['previousClose']
    change = (price/baseline-1)*100
    return {'symbol':symbol,'name':NAMES[symbol],'status':'verified','price':round(price,4),
            'changePct':round(change,4),'asOf':iso(latest['end']),'marketDate':market_date,
            'baselineAt':iso(base['end']),'baselinePrice':round(baseline,4),
            'trend30m':trend,'ema20':round(ema,5) if enough else None,'emaSlopePct':round(slope,5) if enough else None,
            'vwapApprox':round(vwap,5) if vwap else None,'barCount':len(seq),
            'spark':[round(b['close'],4) for b in today],
            'sourceUrl':chart['sourceUrl'],'fetchedAt':chart['fetchedAt'],
            'note':'已完成30分钟K线；涨跌统一较上一正式盘收盘时点' if symbol in ['BTC','ETH','VIX','VIX3M'] else '已完成30分钟K线；较前一正式盘收盘；均价为30分钟HLC3量加权近似'}

def premarket_observation(symbol, chart, cutoff, market_date, previous_close_at):
    """Use only source-timestamped, completed current-day minute bars; never carry close."""
    empty = {'symbol':symbol,'name':NAMES[symbol],'status':'unavailable','price':None,
             'changePct':None,'asOf':None,'marketDate':market_date,'trend30m':'unknown',
             'spark':[],'sourceUrl':chart.get('sourceUrl'),
             'note':chart.get('error','未取得有效盘前报价；不以昨收替代')}
    if 'result' not in chart: return empty
    result = chart['result']; quote = result['indicators']['quote'][0]
    start = dt.datetime.fromisoformat(market_date+'T04:00:00').replace(tzinfo=NY).timestamp()
    opening = dt.datetime.fromisoformat(market_date+'T09:30:00').replace(tzinfo=NY).timestamp()
    if not start <= cutoff < opening: return empty
    seq = []
    for i,t in enumerate(result.get('timestamp',[])):
        values = quote.get('close',[])
        price = values[i] if i < len(values) else None
        volumes = quote.get('volume', [])
        volume = volumes[i] if i < len(volumes) else None
        traded = symbol in ['BTC','ETH','VIX','VIX3M'] or isinstance(volume,(int,float)) and math.isfinite(volume) and volume > 0
        if traded and t % 60 == 0 and start <= t and t+60 <= cutoff and isinstance(price,(int,float)) and math.isfinite(price) and price > 0:
            seq.append((t+60,price))
    if not seq or cutoff-seq[-1][0] > 300:
        empty['note'] = '盘前报价缺失或超过5分钟；不以昨收替代'
        return empty
    meta = result['meta']
    if symbol in ['BTC','ETH']:
        bases = [(t+60,quote['close'][i]) for i,t in enumerate(result.get('timestamp',[]))
                 if t % 60 == 0 and t+60 == previous_close_at and i < len(quote.get('close',[]))
                 and isinstance(quote['close'][i],(int,float)) and quote['close'][i] > 0]
        baseline = bases[-1][1] if bases else None
    else:
        # regularMarketPrice must be the immediately preceding regular close, not
        # chartPreviousClose (the start of the multi-day range) or a stale quote.
        terminal = meta.get('regularMarketTime',0)
        baseline = meta.get('regularMarketPrice') if previous_close_at-60 <= terminal <= previous_close_at+60 else None
    if not isinstance(baseline,(int,float)) or not math.isfinite(baseline) or baseline <= 0:
        empty['note'] = '上一正式盘收盘基准未核实'
        return empty
    timestamp,price = seq[-1]; change = (price/baseline-1)*100
    return {**empty,'status':'verified','price':round(price,4),'changePct':round(change,4),
            'asOf':iso(timestamp),'baselineAt':iso(previous_close_at),'baselinePrice':round(baseline,4),
            'premarketDirection':'up' if change>0 else 'down' if change<0 else 'mixed',
            'quoteSession':'premarket','barCount':len(seq),'spark':[round(x[1],4) for x in seq],
            'fetchedAt':chart['fetchedAt'],
            'note':'当日盘前最新已完成1分钟报价，较上一正式盘收盘；来源可能延迟，非逐笔实时流'}

def get_breadth(market_date, now, cutoff):
    url = 'https://finviz.com/'
    obj = {'status':'unavailable','sourceUrl':url,'fetchedAt':now.isoformat(),'asOf':None,
           'marketDate':market_date,'advancing':None,'declining':None,'upPct':None}
    try:
        html = fetch(url)
        adv = re.search(r'Advancing</p><p>[\d.]+% \(([\d,]+)\)',html)
        dec = re.search(r'Declining</p><p>\(([\d,]+)\)',html)
        date_match = re.search(r'"ticker":"\$MARKET","dateTime":"(\d{4}-\d{2}-\d{2})',html)
        # Finviz has no precise timestamp for the breadth box. Only associate it with
        # a completed session when captured after its close and before the next open.
        local = now.astimezone(NY)
        today_open = local.replace(hour=9,minute=30,second=0,microsecond=0).timestamp()
        today_close = local.replace(hour=16,minute=0,second=0,microsecond=0).timestamp()
        after_target = now.timestamp() >= cutoff and now.timestamp()-cutoff < 20*3600
        premarket_open = local.replace(hour=4,minute=0,second=0,microsecond=0).timestamp()
        closed_window = now.timestamp() < premarket_open or now.timestamp() >= today_close
        closed_aligned = date_match and date_match[1] == market_date and after_target and closed_window
        live_aligned = (local.date().isoformat()==market_date and today_open <= now.timestamp() < today_close
                        and 0 <= now.timestamp()-cutoff < 1800)
        if not (adv and dec and (closed_aligned or live_aligned)):
            raise ValueError('广度快照无法与本轮时段可靠对齐')
        a,d = int(adv[1].replace(',','')),int(dec[1].replace(',',''))
        if a+d == 0:
            raise ValueError('Empty breadth')
        obj.update(status='snapshot',advancing=a,declining=d,upPct=round(100*a/(a+d),2),
                   note='Finviz NYSE/Nasdaq/AMEX 涨跌家数；比例不含平盘。'+('闭市窗口抓取并以该日市场摘要交叉核对' if closed_aligned else '正式盘窗口抓取；网页报价可能延迟')+'；来源未提供该框精确行情时刻。')
    except Exception as error:
        obj['note'] = str(error)
    return obj

def compact_evidence(raw,cutoff,baseline):
    import copy
    compact=copy.deepcopy(raw)
    for key in ['BTC','ETH']:
        record=compact.get(key,{})
        if 'result' not in record: continue
        result=record['result']; times=result.get('timestamp',[])
        indices=[i for i,t in enumerate(times) if abs(t+60-baseline)<=60 or abs(t+60-cutoff)<=600]
        result['timestamp']=[times[i] for i in indices]
        for quote in result.get('indicators',{}).get('quote',[]):
            for column,values in list(quote.items()):
                quote[column]=[values[i] if i<len(values) else None for i in indices]
        record['omittedIrrelevantBars']=len(times)-len(indices)
    return compact

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--market-date',required=True)
    parser.add_argument('--session',choices=['premarket','intraday','late','close'],default='close')
    parser.add_argument('--output',default=str(ROOT/'data.json'))
    args = parser.parse_args(); now = dt.datetime.now(UTC)
    market_date = dt.date.fromisoformat(args.market_date).isoformat()
    old = json.loads((ROOT/'data.json').read_text())
    if args.session == 'premarket':
        # Use the independent batch source first while Yahoo is unreachable.
        prior_day=dt.date.fromisoformat(market_date)-dt.timedelta(days=1)
        while not trading_day(prior_day.isoformat()): prior_day-=dt.timedelta(days=1)
        prior_end=dt.datetime.fromisoformat(prior_day.isoformat()+'T'+CONFIG['earlyCloses'].get(prior_day.isoformat(),'16:00')).replace(tzinfo=NY).timestamp()
        prior=old['assets'] if old['meta'].get('session')=='close' else (old.get('previous') or {}).get('assets',{})
        symbols=[s for s in NAMES if s not in ['BTC','ETH','VIX','VIX3M']]
        try:
            alternative,alternative_raw=alternative_premarket(symbols,prior,market_date,iso(prior_end),NAMES)
        except Exception as error:
            alternative={}; alternative_raw={'error':str(error)}
        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
            raw=dict(zip(['BTC','ETH'],pool.map(lambda symbol:get_chart(symbol,True),['BTC','ETH'])))
        for symbol in NAMES:
            raw.setdefault(symbol,{'error':'无有效盘前来源'})
        raw['alternativePremarket']=alternative_raw
    else:
        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
            raw = dict(zip(NAMES,pool.map(lambda symbol:get_chart(symbol,False),NAMES)))
    if args.session=='premarket' and alternative:
        # Independently published NYSE calendar plus source session date and
        # last verified close replace the unavailable Yahoo calendar metadata.
        previous_day=prior_day.isoformat()
        def period(day):
            start=dt.datetime.fromisoformat(day+'T09:30').replace(tzinfo=NY).timestamp()
            end=dt.datetime.fromisoformat(day+'T'+CONFIG['earlyCloses'].get(day,'16:00')).replace(tzinfo=NY).timestamp()
            return {'start':start,'end':end}
        raw['QQQ']['calendarSource']='https://www.nyse.com/trade/hours-calendars'
        raw['QQQ']['result']={'meta':{'tradingPeriods':[[period(previous_day),period(market_date)]],'currentTradingPeriod':{'regular':period(market_date)}},'timestamp':[],'indicators':{'quote':[{}]}}
    if 'result' not in raw['QQQ']:
        raise SystemExit('QQQ unavailable: refusing to replace snapshot')
    periods = raw['QQQ']['result']['meta'].get('tradingPeriods',[])
    if isinstance(periods,dict): periods = periods.get('regular',[])
    sessions = sorted([p for group in periods for p in group],key=lambda p:p['start'])
    current = raw['QQQ']['result']['meta']['currentTradingPeriod']['regular']
    if not any(p['start']==current['start'] for p in sessions):
        sessions.append(current)
    dated = {dt.datetime.fromtimestamp(p['start'],NY).date().isoformat():p for p in sessions}
    if market_date not in dated:
        raise SystemExit('Source trading calendar does not contain requested market date')
    session = dated[market_date]
    preceding = [p for p in sessions if p['end'] < session['start']]
    if not preceding:
        raise SystemExit('Previous session missing')
    prev = max(preceding,key=lambda p:p['end'])
    if args.session == 'close' and now.timestamp() < session['end']:
        raise SystemExit('Regular session has not closed')
    if args.session == 'premarket':
        cutoff = now.timestamp()
        opening = dt.datetime.fromisoformat(market_date+'T04:00:00').replace(tzinfo=NY).timestamp()
        if not opening <= cutoff < session['start']+300:
            raise SystemExit('Requested date is not in its live premarket window')
        cutoff=min(dt.datetime.now(UTC).timestamp(),session['start'])
        assets = {s:alternative.get(s) or premarket_observation(s,raw[s],cutoff,market_date,prev['end']) for s in NAMES}
        if not any(assets[s]['status']=='verified' for s in ['SPY','QQQ']):
            raise SystemExit('All benchmark premarket sources unavailable')
    else:
        cutoff = min(now.timestamp()//1800*1800,session['end'])
        if cutoff < session['start']+1800:
            raise SystemExit('No completed regular 30-minute bar yet')
        assets = {s:observation(s,c,cutoff,market_date,prev['end']) for s,c in raw.items()}
    if args.session != 'premarket' and any(assets[s]['status']!='verified' for s in ['QQQ','SPY']):
        raise SystemExit('Market benchmark stale or unavailable; previous snapshot preserved')
    old_pulse = old.get('sectorPulse', {})
    now=dt.datetime.now(UTC)
    breadth = {'status':'unavailable','marketDate':market_date,'sourceUrl':'https://finviz.com/','fetchedAt':now.isoformat(),'asOf':None,'advancing':None,'declining':None,'upPct':None,'note':'无可核实的全市场盘前广度'} if args.session=='premarket' else get_breadth(market_date,now,cutoff)
    core_cache = old_pulse.get('coreTickerCache', old_pulse.get('coreTickers', {}))
    sector_pulse = {'status':'unavailable','marketDate':market_date,'targetAsOf':iso(cutoff),'asOf':None,'fetchedAt':now.isoformat(),'returnBasis':'daily','universe':'Finviz 全部细分行业（提供方口径）','universeCount':0,'sourceUrl':'https://finviz.com/groups.ashx?g=industry&v=140&o=-change','dateBasis':None,'rows':[],'gainers':[],'losers':[],'note':'盘前无可核实的全市场细分行业口径'} if args.session=='premarket' else get_sector_pulse(market_date,now,cutoff,session['end'],core_cache)
    # Reuse news only for the same trading date and names still in the top six.
    if old_pulse.get('marketDate') == market_date:
        names = {r['name'] for side in ['gainers','losers'] for r in sector_pulse[side]}
        sector_pulse['news'] = {k:v for k,v in old_pulse.get('news',{}).items() if k in names}
        sector_pulse['researchAt'] = old_pulse.get('researchAt')
    old_breadth = old.get('breadth',{})
    if (breadth['status']=='unavailable' and cutoff==session['end'] and
        old_breadth.get('marketDate')==market_date and old_breadth.get('status') in ['verified','snapshot']):
        breadth = old_breadth  # Same historical observation, retain original fetchedAt and note.
    out = {'meta':{'schemaVersion':18,'timezone':'Asia/Shanghai','edition':'compact',
                   'updatedAt':now.astimezone(CN).isoformat(),'asOf':iso(cutoff),'marketDate':market_date,
                   'session':args.session,'priceBasis':'premarket' if args.session=='premarket' else 'close' if cutoff==session['end'] else 'intraday',
                   'automationEnabled':old.get('meta',{}).get('automationEnabled',False),
                   'nextUpdate':next_update(now),'rulesVersion':'18.2'},
           'assets':assets,'breadth':breadth,'sectorPulse':sector_pulse,
           'news':old.get('news',{}) if old.get('meta',{}).get('schemaVersion')==18 else {},
           'cta':{'status':'unavailable','note':'有可追溯的新仓位估算才展示；不参与核心判断'},
           'previous':None}
    if old.get('meta',{}).get('schemaVersion')==18 and old['meta']['asOf']!=out['meta']['asOf']:
        # Save only compact previous observations; no recursive history input.
        out['previous']={k:old[k] for k in ['meta','assets','breadth']}
    elif old.get('meta',{}).get('schemaVersion')==18:
        out['previous']=old.get('previous')
    evidence = ROOT/'history'/'v18'/f'{market_date}-{args.session}.json'
    evidence.parent.mkdir(parents=True,exist_ok=True)
    evidence.write_text(json.dumps({'fetchedAt':now.isoformat(),'targetAsOf':iso(cutoff),'charts':compact_evidence(raw,cutoff,prev['end']) if args.session=='premarket' else raw,'breadth':out['breadth'],'sectorPulse':sector_pulse},ensure_ascii=False,separators=(',',':'))+'\n')
    out['meta']['evidencePath']=str(evidence.relative_to(ROOT))
    pathlib.Path(args.output).write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'asOf':out['meta']['asOf'],'marketDate':market_date,
        'quotes':{s:{'price':q['price'],'changePct':q['changePct'],'trend':q['trend30m'],'status':q['status']} for s,q in assets.items()},
        'breadth':out['breadth'],'sectorPulse':{k:v for k,v in sector_pulse.items() if k!='rows'}},ensure_ascii=False))

if __name__=='__main__': main()
