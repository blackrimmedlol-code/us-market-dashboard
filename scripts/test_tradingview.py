import unittest
import datetime as dt
from tradingview_premarket import observation

class AlternativeQuoteTests(unittest.TestCase):
    def setUp(self):
        self.prior={'QQQ':{'status':'verified','price':100,'asOf':'2026-09-29T20:00:00+00:00'}}
        row={'premarket_close':102,'close':100,'premarket_volume':20,'premarket_time':int(dt.datetime(2026,9,30,8,tzinfo=dt.timezone.utc).timestamp()),'ticker':'NASDAQ:QQQ'}
        self.a={'startedAt':'2026-09-30T13:05:00+00:00','rows':{'QQQ':{**row,'premarket_volume':10}}}
        self.b={'fetchedAt':'2026-09-30T13:05:20+00:00','rows':{'QQQ':row}}
    def quote(self):
        return observation('QQQ',self.a,self.b,self.prior,'2026-09-30','2026-09-29T20:00:00+00:00',{'QQQ':'QQQ'})
    def test_recent_activity_has_bounded_observation_provenance(self):
        q=self.quote();self.assertEqual(q['status'],'verified');self.assertEqual(q['changePct'],2);self.assertEqual(q['quoteTimeType'],'observed-update-bound');self.assertEqual(q['spark'],[])
    def test_no_activity_or_stale_pair_is_rejected(self):
        self.a['rows']['QQQ']['premarket_volume']=20;self.assertEqual(self.quote()['status'],'unavailable')
        self.a['rows']['QQQ']['premarket_volume']=10;self.a['startedAt']='2026-09-30T12:00:00+00:00';self.assertEqual(self.quote()['status'],'unavailable')
    def test_wrong_session_or_mismatched_baseline_is_rejected(self):
        self.b['rows']['QQQ']['close']=99;self.assertEqual(self.quote()['status'],'unavailable')
        self.b['rows']['QQQ']['close']=100;self.b['rows']['QQQ']['premarket_time']-=86400;self.assertEqual(self.quote()['status'],'unavailable')
