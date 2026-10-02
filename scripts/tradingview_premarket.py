"""Independent batch fallback; prove recent activity with two source observations.
The screener exposes a session date, not a trade timestamp. Do not invent one.
"""
import datetime as dt
import json
import math
import subprocess
import time
from zoneinfo import ZoneInfo
NY=ZoneInfo('America/New_York'); UTC=dt.timezone.utc
URL='https://scanner.tradingview.com/america/scan'
COLS=['name','close','premarket_close','premarket_change','premarket_volume','premarket_time','update_time']

def scan(symbols):
    start=dt.datetime.now(UTC)
    exchanges={'SPY':'AMEX','RSP':'AMEX','SPMO':'AMEX','DRAM':'CBOE'}
    payload={'symbols':{'tickers':[exchanges.get(s,'NASDAQ')+':'+s for s in symbols],'query':{'types':[]}}, 'columns':COLS}
    raw=json.loads(subprocess.check_output(['curl','--fail','-sS','--max-time','20','-H','Content-Type: application/json','--data-binary',json.dumps(payload),URL],text=True))
    end=dt.datetime.now(UTC)
    rows={}
    for item in raw['data']:
        row=dict(zip(COLS,item['d'])); row['ticker']=item['s']
        if row['name'] not in rows: rows[row['name']]=row
    return {'startedAt':start.isoformat(),'fetchedAt':end.isoformat(),'rows':rows}

def observation(symbol, first, second, prior, day, baseline_at, names):
    row=second['rows'].get(symbol,{}); earlier=first['rows'].get(symbol,{})
    empty={'symbol':symbol,'name':names[symbol],'status':'unavailable','price':None,'changePct':None,'asOf':None,'marketDate':day,'trend30m':'unknown','spark':[], 'sourceUrl':URL,'note':'替代源未核实当日盘前报价或近期成交'}
    try:
        price,base,volume=row['premarket_close'],row['close'],row['premarket_volume']
        stamp=dt.datetime.fromtimestamp(row['premarket_time'],NY)
        observed=dt.datetime.fromisoformat(second['fetchedAt'])
        age=(observed-dt.datetime.fromisoformat(first['startedAt'])).total_seconds()
        valid=all(isinstance(x,(int,float)) and math.isfinite(x) and x>0 for x in [price,base,volume])
        active=price!=earlier.get('premarket_close') or volume>earlier.get('premarket_volume',volume)
        opening=dt.datetime.fromisoformat(day+'T09:30').replace(tzinfo=NY)
        final_window=0<=(observed-opening.astimezone(UTC)).total_seconds()<=300
        baseline=prior.get(symbol,{})
        valid=valid and stamp.date().isoformat()==day and baseline.get('status')=='verified' and baseline.get('asOf')==baseline_at and abs(base-baseline['price'])<=max(.001,base*.001)
        if not valid or not (active or final_window) or not 0<=age<=300: return empty
        change=(price/base-1)*100
        return {**empty,'status':'verified','price':round(price,4),'changePct':round(change,4),'asOf':opening.astimezone(UTC).isoformat() if final_window else second['fetchedAt'],'fetchedAt':second['fetchedAt'],'baselineAt':baseline_at,'baselinePrice':base,'premarketDirection':'up' if change>0 else 'down' if change<0 else 'mixed','quoteSession':'premarket','quoteTimeType':'premarket-session-final' if final_window else 'observed-update-bound','quoteTimeBounds':{'from':first['startedAt'],'to':second['fetchedAt']},'sourceSessionAt':dt.datetime.fromtimestamp(row['premarket_time'],UTC).isoformat(),'barCount':0,'spark':[],'sourceUrl':'https://www.tradingview.com/symbols/'+row['ticker'].replace(':','-')+'/', 'note':'TradingView当日盘前最终成交报价，行情截止开盘边界；逐笔成交时间未提供，非正式盘实时报价。' if final_window else 'TradingView盘前成交报价；两次读取间价格或累计成交量更新，近期活动已核实；显示的是观察时间范围，来源未提供逐笔时间，不作为1分钟K线或精确同步报价。'}
    except (KeyError,TypeError,ValueError): return empty

def batch(symbols,prior,day,baseline_at,names):
    first=scan(symbols); time.sleep(15); second=scan(symbols)
    return {s:observation(s,first,second,prior,day,baseline_at,names) for s in symbols},{'sourceUrl':URL,'first':first,'second':second}
