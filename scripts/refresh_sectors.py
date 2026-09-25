"""Reuse v17's Finviz industry parser for a compact top-three daily leaderboard.
No LLM calls. Each run fetches one full table and checks its trading-date anchor.
"""
import datetime as dt
import json
import math
import re
import subprocess
from html import unescape
from html.parser import HTMLParser
from zoneinfo import ZoneInfo
from concurrent.futures import ThreadPoolExecutor

NY = ZoneInfo('America/New_York')
URL = 'https://finviz.com/groups.ashx?g=industry&v=140&o=-change'
ANCHOR_URL = 'https://finviz.com/quote.ashx?t=SPY'


class Members(HTMLParser):
    def __init__(self, industry):
        super().__init__()
        self.industry, self.symbols, self.optionable = industry, [], False

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == 'option' and a.get('value') == 'option' and 'selected' in a:
            self.optionable = True
        symbol = a.get('data-boxover-ticker', '')
        if (a.get('data-boxover-industry') == self.industry
                and re.fullmatch(r'[A-Z][A-Z0-9.-]{0,9}', symbol)
                and symbol not in self.symbols):
            self.symbols.append(symbol)


def core_members(industry):
    slug = re.sub('[^a-z0-9]', '', industry.lower())
    url = f'https://finviz.com/screener.ashx?v=111&f=ind_{slug},sh_opt_option&o=-marketcap'
    out = {'symbols': [], 'sourceUrl': url, 'selection': 'optionable-marketcap'}
    try:
        parser = Members(industry)
        parser.feed(fetch(url))
        if not parser.optionable or not parser.symbols:
            raise ValueError('行业成员或期权筛选未核实')
        out['symbols'] = parser.symbols[:4]
        out['status'] = 'verified'
    except Exception as error:
        out.update(status='unavailable', note=str(error)[:140])
    out['checkedAt'] = dt.datetime.now(dt.timezone.utc).isoformat()
    return out


def attach_core_members(pulse):
    names = [r['name'] for r in pulse.get('gainers', []) + pulse.get('losers', [])]
    with ThreadPoolExecutor(max_workers=6) as pool:
        pulse['coreTickers'] = dict(zip(names, pool.map(core_members, names)))
    return pulse


def fetch(url):
    return subprocess.check_output(['curl', '-fLsS', '--max-time', '25', '-A',
                                    'Mozilla/5.0', url], text=True)


class Table(HTMLParser):
    # Copied from legacy/refresh-sectors.py; the legacy archive stays frozen.
    def __init__(self):
        super().__init__()
        self.rows, self.row, self.cell = [], [], None

    def handle_starttag(self, tag, attrs):
        if tag == 'tr':
            self.row = []
        if tag == 'td':
            self.cell = []

    def handle_data(self, s):
        if self.cell is not None:
            self.cell.append(s)

    def handle_endtag(self, tag):
        if tag == 'td' and self.cell is not None:
            self.row.append(''.join(self.cell).strip())
            self.cell = None
        if tag == 'tr':
            if len(self.row) == 12 and self.row[0].isdigit():
                self.rows.append(self.row)
            self.row = []


def collect(html):
    p = Table()
    p.feed(html)
    rows = [{'name': r[1], 'changePct': float(r[10].replace('%', '').replace(',', ''))}
            for r in p.rows]
    if (len(rows) < 100 or len({r['name'] for r in rows}) != len(rows)
            or any(not r['name'] or not math.isfinite(r['changePct']) for r in rows)):
        raise ValueError('Incomplete/duplicate/invalid industry universe')
    return rows


def rank(rows):
    return {key: sorted([r for r in rows if r['changePct'] * sign > 0],
                       key=lambda r: (-sign * r['changePct'], r['name']))[:3]
            for key, sign in [('gainers', 1), ('losers', -1)]}


def date_basis(anchor, market_date, now, cutoff, regular_close_at=None):
    plain = re.sub('<[^>]+>', ' ', re.sub(r'<script\b[^>]*>.*?</script>', '', anchor, flags=re.S))
    plain = re.sub(r'\s+', ' ', unescape(plain))
    marker = re.search(r'Last Close.{0,180}', plain)
    expected = dt.date.fromisoformat(market_date).strftime('%b %d').replace(' 0', ' ')
    if not marker or not re.search(r'\b' + re.escape(expected) + r'\b', marker[0]):
        raise ValueError('行业日期锚点不匹配，未将新行情标为旧时段')
    local = now.astimezone(NY)
    end = dt.datetime.fromtimestamp(cutoff, NY)
    age = now.timestamp() - cutoff
    regular_close_at = regular_close_at or end.replace(hour=16, minute=0, second=0, microsecond=0).timestamp()
    # Full-table quotes have no exact timestamp. A live round must be recent;
    # a closed snapshot may be collected only before the next regular open.
    live = (local.date().isoformat() == market_date and dt.time(9, 30) <= local.time()
            and now.timestamp() < regular_close_at)
    closed = (cutoff == regular_close_at and not live and 0 <= age < 96 * 3600 and
              (local.date() == end.date() or local.weekday() >= 5 or local.time() < dt.time(9, 30)))
    if end.date().isoformat() != market_date or not (live and 0 <= age < 1800 or closed):
        raise ValueError('行业快照无法对齐本轮窗口，未复用旧榜单')
    return '同源 SPY 日期锚点：' + marker[0] + '；行业表未披露逐项行情时点。'


def get_sector_pulse(market_date, now, cutoff, regular_close_at=None):
    out = {'status': 'unavailable', 'marketDate': market_date,
           'targetAsOf': dt.datetime.fromtimestamp(cutoff, dt.timezone.utc).isoformat(),
           'asOf': None, 'fetchedAt': now.isoformat(), 'returnBasis': 'daily',
           'universe': 'Finviz 全部细分行业（提供方口径）', 'universeCount': 0,
           'sourceUrl': URL, 'dateBasis': None, 'rows': [], 'gainers': [], 'losers': []}
    try:
        try:
            html = fetch(URL)
        except Exception:
            html = fetch(URL.replace('o=-change', 'o=change'))
        rows = collect(html)
        basis = date_basis(fetch(ANCHOR_URL), market_date, now, cutoff, regular_close_at)
        out.update(status='snapshot', universeCount=len(rows), rows=rows,
                   dateBasis=basis, **rank(rows))
        out['note'] = '日累计涨跌幅；来源可能延迟，不代表两轮更新之间的涨跌。'
        attach_core_members(out)
    except Exception as error:
        out['note'] = str(error)[:220]
    out['fetchedAt'] = dt.datetime.now(dt.timezone.utc).isoformat()
    return out


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('market_date')
    parser.add_argument('cutoff', help='ISO timestamp of dashboard price window')
    parser.add_argument('output')
    args = parser.parse_args()
    result = get_sector_pulse(args.market_date, dt.datetime.now(dt.timezone.utc),
                              dt.datetime.fromisoformat(args.cutoff).timestamp())
    with open(args.output, 'w') as f:
        json.dump(result, f, ensure_ascii=False, separators=(',', ':'))
    print(json.dumps({k: v for k, v in result.items() if k != 'rows'}, ensure_ascii=False))
