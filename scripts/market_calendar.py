"""Shared, source-verified calendar for the browser and scheduled runner."""
import datetime as dt
import json
import pathlib
from zoneinfo import ZoneInfo

ROOT = pathlib.Path(__file__).resolve().parents[1]
NY = ZoneInfo('America/New_York')
UTC = dt.timezone.utc
CONFIG = json.loads((ROOT / 'schedule.json').read_text())

def trading_day(day):
    date = dt.date.fromisoformat(day)
    if not CONFIG['validFrom'] <= day <= CONFIG['validThrough']:
        raise ValueError('交易日历已超出已核实范围')
    return date.weekday() < 5 and day not in CONFIG['holidays'] and day not in CONFIG.get('closures', [])

def nominal(day, session):
    item = next(x for x in CONFIG['sessions'] if x['id'] == session)
    return dt.datetime.fromisoformat(day + 'T' + item['time']).replace(tzinfo=NY)

def next_update(now):
    day = now.astimezone(NY).date()
    for offset in range(12):
        date = (day + dt.timedelta(days=offset)).isoformat()
        if not trading_day(date):
            continue
        for item in CONFIG['sessions']:
            when = nominal(date, item['id'])
            if when > now:
                return {'session': item['id'], 'marketDate': date, 'at': when.astimezone(UTC).isoformat()}
    raise ValueError('后续交易日程未核实')
