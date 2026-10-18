"""Compact, completed RTH 60-minute observations for the GNOT workbench.

No LLM, position data or orders. A failed request produces nulls, not invented
indicators. Yahoo's final shortened session candle is included and identified.
"""
import concurrent.futures
import datetime as dt
import json
import math
import subprocess
from market_calendar import CONFIG, NY, UTC, trading_day

SYMBOLS = ('SOXL', 'GDXU', 'BITX')
WARMUP = 250
METHOD = {'source': 'Yahoo Finance chart', 'interval': '60m', 'regularOnly': True,
          'emaSeed': 'SMA of first N closed bars', 'atr': 'Wilder RMA14 of true range',
          'warmupBars': WARMUP, 'sessionAnchor': '09:30 America/New_York',
          'sessionEndCandle': 'closed shortened final candle included',
          'priceBasis': 'same provider USD OHLC; never underlying proxy prices'}

def session(day):
    if not trading_day(day):
        return None
    end = CONFIG.get('earlyCloses', {}).get(day, '16:00')
    return (dt.datetime.fromisoformat(day + 'T09:30').replace(tzinfo=NY),
            dt.datetime.fromisoformat(day + 'T' + end).replace(tzinfo=NY))

def expected_bars(cutoff, days=100):
    result = []
    day = cutoff.astimezone(NY).date()
    for offset in range(days, -1, -1):
        text = (day - dt.timedelta(days=offset)).isoformat()
        if text < CONFIG['validFrom']:
            continue
        bounds = session(text)
        if not bounds:
            continue
        start, close = bounds
        while start < close:
            end = min(start + dt.timedelta(hours=1), close)
            if end <= cutoff:
                result.append((int(start.timestamp()), int(end.timestamp())))
            start += dt.timedelta(hours=1)
    return result

def ema(values, period):
    value = sum(values[:period]) / period
    alpha = 2 / (period + 1)
    for item in values[period:]:
        value += alpha * (item - value)
    return value

def atr(bars, period=14):
    previous = bars[0]['close']
    ranges = []
    for b in bars:
        ranges.append(max(b['high'] - b['low'], abs(b['high'] - previous), abs(b['low'] - previous)))
        previous = b['close']
    value = sum(ranges[:period]) / period
    for item in ranges[period:]:
        value = (value * (period - 1) + item) / period
    return value

def unavailable(symbol, reason, source_url=None):
    return {'symbol': symbol, 'status': 'unavailable', 'trend': 'unknown',
            'close1h': None, 'ema20': None, 'ema50': None, 'atr14': None,
            'barStartAt': None, 'barCloseAt': None, 'marketDate': None,
            'barCount': 0, 'sourceUrl': source_url, 'note': str(reason)[:240]}

def observation(symbol, result, cutoff, source_url, fetched_at):
    meta = result.get('meta', {})
    if meta.get('symbol', '').upper() != symbol or meta.get('exchangeTimezoneName') != 'America/New_York' or meta.get('currency') != 'USD' or meta.get('dataGranularity') not in ['1h', '60m']:
        raise ValueError('标的、币种或交易所时区不匹配')
    expected = expected_bars(cutoff)
    if len(expected) < WARMUP:
        raise ValueError('已核实交易日历内的小时样本不足')
    wanted = dict(expected)
    quote = result['indicators']['quote'][0]
    found = {}
    for i, timestamp in enumerate(result.get('timestamp', [])):
        if timestamp not in wanted:
            continue  # Current, extended-session and terminal live markers are excluded.
        if timestamp in found:
            raise ValueError('来源存在重复小时K线')
        row = {key: quote.get(key, [])[i] if i < len(quote.get(key, [])) else None for key in ['open', 'high', 'low', 'close']}
        if not all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) and v > 0 for v in row.values()):
            continue
        if row['low'] > min(row['open'], row['close']) or row['high'] < max(row['open'], row['close']) or row['low'] > row['high']:
            continue
        found[timestamp] = {'start': timestamp, 'end': wanted[timestamp], **row}
    required = expected[-WARMUP:]
    if any(start not in found for start, _ in required):
        raise ValueError('最近250根已完成正式盘小时K线缺失或来源尚未覆盖最新收盘K线')
    # Use exactly the same deterministic warmup window on every run.
    bars = [found[start] for start, _ in required]
    prices = [b['close'] for b in bars]
    last = bars[-1]
    e20, e50, a14 = ema(prices, 20), ema(prices, 50), atr(bars)
    if not all(math.isfinite(x) and x > 0 for x in [e20, e50, a14]):
        raise ValueError('指标未形成有效正数')
    asof = dt.datetime.fromtimestamp(last['end'], UTC)
    return {'symbol': symbol, 'status': 'verified',
            'trend': 'qualified' if last['close'] > e50 and e20 > e50 else 'not-qualified',
            'close1h': last['close'], 'ema20': e20, 'ema50': e50, 'atr14': a14,
            'barStartAt': dt.datetime.fromtimestamp(last['start'], UTC).isoformat(),
            'barCloseAt': asof.isoformat(), 'marketDate': asof.astimezone(NY).date().isoformat(),
            'barCount': len(bars), 'shortenedSessionBar': last['end'] - last['start'] < 3600,
            'sourceUrl': source_url, 'fetchedAt': fetched_at,
            'note': '已收盘正式盘1小时快照；不是实时买入信号'}

def get_chart(symbol):
    errors = []
    for host in ['query1', 'query2']:
        url = f'https://{host}.finance.yahoo.com/v8/finance/chart/{symbol}?interval=60m&range=3mo&includePrePost=false'
        try:
            body = subprocess.check_output(['curl', '--fail', '-L', '-sS', '--connect-timeout', '4', '--max-time', '10', '-A', 'Mozilla/5.0', url], text=True, stderr=subprocess.PIPE, timeout=12)
            result = json.loads(body)['chart']['result'][0]
            return result, url, dt.datetime.now(UTC).isoformat()
        except Exception as error:
            errors.append(type(error).__name__)
    raise RuntimeError('Yahoo两端请求失败：' + '/'.join(errors))

def failed_snapshot(now, session_name, market_date, reason):
    return {'schemaVersion': 1, 'rulesVersion': 'gnot-trend-1h-v1', 'generatedAt': now.isoformat(),
            'session': session_name, 'requestedMarketDate': market_date,
            'timeframe': '1h', 'regularOnly': True, 'method': METHOD,
            'assets': {symbol: unavailable(symbol, reason) for symbol in SYMBOLS}}

def collect(now, session_name, market_date, loader=get_chart):
    output = failed_snapshot(now, session_name, market_date, '尚未取得来源')
    def one(symbol):
        try:
            result, url, fetched = loader(symbol)
            return observation(symbol, result, now, url, fetched)
        except Exception as error:
            return unavailable(symbol, str(error))
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        output['assets'] = dict(zip(SYMBOLS, pool.map(one, SYMBOLS)))
    return output

def validate_feed(feed):
    if feed.get('schemaVersion') != 1 or feed.get('rulesVersion') != 'gnot-trend-1h-v1' or feed.get('regularOnly') is not True or feed.get('timeframe') != '1h' or set(feed.get('assets', {})) != set(SYMBOLS):
        raise ValueError('趋势快照契约不匹配')
    generated = dt.datetime.fromisoformat(feed['generatedAt'])
    for symbol, item in feed['assets'].items():
        if item['symbol'] != symbol or item['status'] not in ['verified', 'unavailable']:
            raise ValueError('趋势标的或状态错误')
        numbers = [item.get(key) for key in ['close1h', 'ema20', 'ema50', 'atr14']]
        if item['status'] == 'unavailable':
            if any(v is not None for v in numbers) or item.get('barCloseAt') is not None or item['trend'] != 'unknown':
                raise ValueError('来源失败时不得保留数字冒充本轮数据')
        else:
            if not all(isinstance(v, (int, float)) and math.isfinite(v) and v > 0 for v in numbers) or item['barCount'] < WARMUP or dt.datetime.fromisoformat(item['barCloseAt']) > generated:
                raise ValueError('趋势数值或已收盘时间无效')
            expected = 'qualified' if numbers[0] > numbers[2] and numbers[1] > numbers[2] else 'not-qualified'
            if item['trend'] != expected:
                raise ValueError('趋势标签与数值不一致')
    return feed

if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--session', required=True)
    parser.add_argument('--market-date', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    value = validate_feed(collect(dt.datetime.now(UTC), args.session, args.market_date))
    with open(args.output, 'w') as file:
        json.dump(value, file, ensure_ascii=False, indent=2)
        file.write('\n')
    print(json.dumps({s: {'status': x['status'], 'asOf': x['barCloseAt'], 'note': x['note']} for s, x in value['assets'].items()}, ensure_ascii=False))
