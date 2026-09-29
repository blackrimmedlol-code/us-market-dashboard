import copy
import datetime as dt
import importlib.util
import json
import pathlib
import unittest
from unittest.mock import patch

ROOT = pathlib.Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('refresh', ROOT/'scripts'/'refresh-dashboard.py')
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)

class RefreshTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.evidence = json.loads((ROOT/'history/v18/2026-09-23-close.json').read_text())
        cls.data = json.loads((ROOT/'fixtures/trial-data.json').read_text())

    def test_recorded_sample_replays(self):
        # Frozen source evidence, not a live-network assertion.
        cutoff = dt.datetime.fromisoformat(self.evidence['targetAsOf']).timestamp()
        for symbol in ['QQQ','MU','WDC','BTC','SPCX']:
            baseline = dt.datetime.fromisoformat(self.data['assets'][symbol]['baselineAt']).timestamp()
            q = r.observation(symbol,self.evidence['charts'][symbol],cutoff,'2026-09-23',baseline)
            self.assertEqual(q['status'],'verified')
            self.assertAlmostEqual(q['price'],self.data['assets'][symbol]['price'],places=3)

    def test_live_terminal_is_not_complete_bar(self):
        chart = self.evidence['charts']['QQQ']
        for bar in r.bars(chart,'QQQ'):
            local = dt.datetime.fromtimestamp(bar['t'],r.NY)
            self.assertLess(local.hour*60+local.minute,960)
            self.assertEqual(bar['end']-bar['t'],1800)

    def test_stale_source_does_not_carry_price(self):
        cutoff=dt.datetime.fromisoformat(self.evidence['targetAsOf']).timestamp()+86400
        q=r.observation('QQQ',self.evidence['charts']['QQQ'],cutoff,'2026-09-24',cutoff-86400)
        self.assertEqual(q['status'],'unavailable')
        self.assertIsNone(q['price'])

    def test_no_future_bar_in_intraday(self):
        cutoff=dt.datetime.fromisoformat('2026-09-23T15:00:00+00:00').timestamp()
        baseline=dt.datetime.fromisoformat(self.data['assets']['QQQ']['baselineAt']).timestamp()
        q=r.observation('QQQ',self.evidence['charts']['QQQ'],cutoff,'2026-09-23',baseline)
        self.assertLessEqual(dt.datetime.fromisoformat(q['asOf']).timestamp(),cutoff)

    def test_premarket_breadth_never_masquerades_as_prior_close(self):
        html='Advancing</p><p>50% (100)</p> Declining</p><p>(100)</p> "ticker":"$MARKET","dateTime":"2026-09-23"'
        cutoff=dt.datetime.fromisoformat('2026-09-23T20:00:00+00:00').timestamp()
        with patch.object(r,'fetch',return_value=html):
            for hour,status in [(7,'snapshot'),(8,'unavailable'),(12,'unavailable')]:
                now=dt.datetime(2026,9,24,hour,30,tzinfo=dt.timezone.utc)
                self.assertEqual(r.get_breadth('2026-09-23',now,cutoff)['status'],status)

if __name__=='__main__':
    unittest.main()

class PremarketTests(unittest.TestCase):
    def setUp(self):
        self.cutoff=dt.datetime.fromisoformat('2026-09-29T13:05:30+00:00').timestamp()
        self.baseline=dt.datetime.fromisoformat('2026-09-28T20:00:00+00:00').timestamp()
        self.chart={'sourceUrl':'https://example.com/chart','fetchedAt':r.iso(self.cutoff),
                    'result':{'meta':{'regularMarketTime':self.baseline,'regularMarketPrice':100},
                              'timestamp':[self.cutoff-150,self.cutoff-90,self.cutoff-30],
                              'indicators':{'quote':[{'close':[101,102,999]}]}}}
    def read(self):
        return r.premarket_observation('QQQ',self.chart,self.cutoff,'2026-09-29',self.baseline)
    def test_uses_latest_completed_premarket_minute_and_prior_close(self):
        q=self.read()
        self.assertEqual(q['price'],102)
        self.assertEqual(q['changePct'],2)
        self.assertEqual(q['trend30m'],'unknown')
        self.assertEqual(q['premarketDirection'],'up')
        self.assertEqual(q['marketDate'],'2026-09-29')
    def test_previous_day_or_stale_price_is_unavailable(self):
        for timestamps in [[self.baseline-60],[self.cutoff-630]]:
            self.chart['result']['timestamp']=timestamps
            q=self.read()
            self.assertEqual(q['status'],'unavailable')
            self.assertIsNone(q['price'])
    def test_stale_regular_baseline_is_not_accepted(self):
        self.chart['result']['meta']['regularMarketTime']-=86400
        self.assertEqual(self.read()['status'],'unavailable')
    def test_outside_premarket_is_rejected(self):
        self.cutoff+=3600
        self.assertEqual(self.read()['status'],'unavailable')
    def test_crypto_uses_same_previous_equity_close_instead_of_24h(self):
        self.chart['result']['timestamp'].insert(0,self.baseline-60)
        self.chart['result']['indicators']['quote'][0]['close'].insert(0,50)
        q=r.premarket_observation('BTC',self.chart,self.cutoff,'2026-09-29',self.baseline)
        self.assertEqual(q['baselinePrice'],50)
        self.assertEqual(q['changePct'],104)
