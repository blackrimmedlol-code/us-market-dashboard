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
