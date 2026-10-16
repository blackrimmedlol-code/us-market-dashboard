import datetime as dt
import unittest
from refresh_sectors import collect, date_basis, rank

class SectorTests(unittest.TestCase):
    def test_parser_uses_daily_change_not_weekly_performance(self):
        rows=[]
        for i in range(110):
            cells=[str(i+1), 'Industry '+str(i)]+['99.9%']*8+[str(i/10)+'%', '0']
            rows.append('<tr>'+''.join('<td>'+c+'</td>' for c in cells)+'</tr>')
        result=collect('<table>'+''.join(rows)+'</table>')
        self.assertEqual(rank(result)['gainers'][0]['changePct'],10.9)
        with self.assertRaises(ValueError):
            collect('<table>'+rows[0]+'</table>')

    def test_no_later_close_data_in_historical_intraday_slot(self):
        now=dt.datetime.fromisoformat('2026-09-25T02:00:00+00:00')
        with self.assertRaises(ValueError):
            date_basis('Last Close 767 Sep 24 3:59 PM', '2026-09-24', now,
                       dt.datetime.fromisoformat('2026-09-24T18:00:00+00:00').timestamp())

    def test_same_close_allowed_until_next_open_but_date_mismatch_rejected(self):
        now=dt.datetime.fromisoformat('2026-09-25T02:00:00+00:00')
        cutoff=dt.datetime.fromisoformat('2026-09-24T20:00:00+00:00').timestamp()
        self.assertIn('SPY',date_basis('Last Close 767 Sep 24 3:59 PM','2026-09-24',now,cutoff))
        with self.assertRaises(ValueError):
            date_basis('Last Close 767 Sep 23 3:59 PM','2026-09-24',now,cutoff)

    def test_insufficient_gainers_not_padded(self):
        rows=[{'name':'A','changePct':1},{'name':'B','changePct':0},{'name':'C','changePct':-1}]
        self.assertEqual(len(rank(rows)['gainers']),1)
        self.assertEqual(len(rank(rows)['losers']),1)

    def test_early_close_uses_exchange_close_not_fixed_1600(self):
        now=dt.datetime.fromisoformat('2026-11-27T19:00:00+00:00')
        cutoff=dt.datetime.fromisoformat('2026-11-27T18:00:00+00:00').timestamp()
        self.assertIn('SPY',date_basis('Last Close 767 Nov 27 12:59 PM','2026-11-27',now,cutoff,cutoff))

    def test_current_quote_markup_accepts_zero_padded_day_not_news_dates(self):
        now = dt.datetime.fromisoformat('2026-10-04T05:00:00+00:00')
        cutoff = dt.datetime.fromisoformat('2026-10-02T20:00:00+00:00').timestamp()
        anchor = '<span class="quote-price_date">Oct 02<span class="muted"> • </span>3:59 PM ET</span>'
        self.assertIn('SPY', date_basis(anchor, '2026-10-02', now, cutoff))
        with self.assertRaises(ValueError):
            date_basis(anchor.replace('Oct 02', 'Oct 01') + '<td>Oct-02-26 news</td>', '2026-10-02', now, cutoff)
