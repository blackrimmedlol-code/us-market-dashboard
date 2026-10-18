import copy
import datetime as dt
import importlib.util
import json
import pathlib
import tempfile
import unittest
from unittest.mock import patch
from trading_trends import expected_bars, observation, collect, failed_snapshot, validate_feed, ema, atr, UTC

ROOT=pathlib.Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('trend_pipeline',ROOT/'scripts/update-session.py')
pipeline=importlib.util.module_from_spec(spec)
spec.loader.exec_module(pipeline)

def chart(symbol, cutoff, rising=False):
    bars=expected_bars(cutoff)[-280:]
    close=[100+i*.2 if rising else 100 for i in range(len(bars))]
    return {'meta':{'symbol':symbol,'currency':'USD','exchangeTimezoneName':'America/New_York','dataGranularity':'1h'},
            'timestamp':[a for a,b in bars], 'indicators':{'quote':[{'open':close[:],'high':[c+2 for c in close],'low':[c-2 for c in close],'close':close}]}}

class TrendTests(unittest.TestCase):
    def setUp(self):
        self.now=dt.datetime(2026,10,19,15,5,tzinfo=UTC)
        self.url='https://query1.finance.yahoo.com/v8/finance/chart/SOXL?interval=60m'
    def observe(self,raw=None,now=None):
        return observation('SOXL',raw or chart('SOXL',now or self.now),now or self.now,self.url,self.now.isoformat())
    def test_only_completed_hour_and_latest_expected_bar(self):
        r=self.observe();self.assertEqual(r['barCloseAt'],'2026-10-19T14:30:00+00:00');self.assertEqual(r['barCount'],250)
    def test_live_and_extended_markers_do_not_enter_ema(self):
        raw=chart('SOXL',self.now);raw['timestamp'] += [int(dt.datetime(2026,10,19,14,30,tzinfo=UTC).timestamp()),int(dt.datetime(2026,10,19,12,tzinfo=UTC).timestamp())]
        for key in raw['indicators']['quote'][0]:raw['indicators']['quote'][0][key] += [99999,99999]
        self.assertEqual(self.observe(raw)['close1h'],100)
    def test_constant_prices_match_independent_reference_values(self):
        r=self.observe();self.assertEqual(r['ema20'],100);self.assertEqual(r['ema50'],100);self.assertEqual(r['atr14'],4);self.assertEqual(r['trend'],'not-qualified')
    def test_rising_price_qualifies_but_equality_does_not(self):
        self.assertEqual(self.observe(chart('SOXL',self.now,True))['trend'],'qualified');self.assertEqual(ema([1,2,3,4,5],3),4)
    def test_wilder_true_range_includes_gap(self):
        bars=[{'high':101,'low':99,'close':100} for _ in range(13)]+[{'high':111,'low':109,'close':110}]
        self.assertAlmostEqual(atr(bars),(13*2+11)/14)
    def test_missing_middle_or_latest_hour_is_rejected(self):
        for index in [-1,-80]:
            raw=chart('SOXL',self.now);raw['timestamp'].pop(index)
            for values in raw['indicators']['quote'][0].values():values.pop(index)
            with self.assertRaisesRegex(ValueError,'缺失'):self.observe(raw)
    def test_provider_identity_and_invalid_prices_are_rejected(self):
        raw=chart('SOXL',self.now);raw['meta']['symbol']='SOXX'
        with self.assertRaisesRegex(ValueError,'不匹配'):self.observe(raw)
        raw=chart('SOXL',self.now);raw['indicators']['quote'][0]['close'][-1]=float('nan')
        with self.assertRaisesRegex(ValueError,'缺失'):self.observe(raw)
    def test_early_close_is_final_completed_shortened_candle(self):
        now=dt.datetime(2026,11,27,18,25,tzinfo=UTC);r=self.observe(chart('SOXL',now),now)
        self.assertEqual(r['barCloseAt'],'2026-11-27T18:00:00+00:00');self.assertTrue(r['shortenedSessionBar'])
    def test_premarket_and_weekend_keep_actual_prior_close(self):
        for now in [dt.datetime(2026,10,19,13,5,tzinfo=UTC),dt.datetime(2026,10,18,16,tzinfo=UTC)]:
            r=self.observe(chart('SOXL',now),now);self.assertEqual(r['barCloseAt'],'2026-10-16T20:00:00+00:00');self.assertEqual(r['marketDate'],'2026-10-16')
    def test_dst_calendar_uses_actual_new_york_bar_boundaries(self):
        a=expected_bars(dt.datetime(2026,10,30,15,5,tzinfo=UTC))[-1];b=expected_bars(dt.datetime(2026,11,2,16,5,tzinfo=UTC))[-1]
        self.assertEqual(dt.datetime.fromtimestamp(a[0],UTC).hour,13);self.assertEqual(dt.datetime.fromtimestamp(b[0],UTC).hour,14)
    def test_failed_source_has_nulls_and_no_current_label(self):
        def fail(_):raise RuntimeError('isolated test failure')
        f=validate_feed(collect(self.now,'intraday','2026-10-19',fail));self.assertTrue(all(r['close1h'] is None and r['barCloseAt'] is None for r in f['assets'].values()))
    def test_independent_symbol_failure_does_not_remove_other_valid_rows(self):
        def load(symbol):
            if symbol=='GDXU':raise RuntimeError('isolated missing source')
            return chart(symbol,self.now),self.url.replace('SOXL',symbol),self.now.isoformat()
        f=validate_feed(collect(self.now,'intraday','2026-10-19',load));self.assertEqual(f['assets']['GDXU']['status'],'unavailable');self.assertEqual(f['assets']['BITX']['status'],'verified')
    def test_label_cannot_disagree_with_numbers(self):
        def load(symbol):return chart(symbol,self.now),self.url.replace('SOXL',symbol),self.now.isoformat()
        f=collect(self.now,'intraday','2026-10-19',load);f['assets']['SOXL']['trend']='qualified'
        with self.assertRaisesRegex(ValueError,'标签'):validate_feed(f)
    def test_low_budget_does_not_launch_fetch_or_break_main_output(self):
        with tempfile.TemporaryDirectory() as directory:
            state={'deadlineAt':(self.now+dt.timedelta(seconds=16)).isoformat(),'session':'intraday','marketDate':'2026-10-19'}
            with patch.object(pipeline,'ROOT',pathlib.Path(directory)),patch.object(pipeline,'now',return_value=self.now),patch.object(pipeline,'command') as command:
                result=pipeline.refresh_workbench_trends(state);command.assert_not_called();self.assertTrue(all(v=='unavailable' for v in result.values()));validate_feed(pipeline.read(pathlib.Path(directory)/'trading-trends.json'))
    def test_deploy_verification_requires_trend_file_when_in_plan(self):
        feed=failed_snapshot(self.now,'intraday','2026-10-19','test missing')
        plan={'dataDigest':pipeline.digest({'meta':1}),'trendsDigest':pipeline.digest(feed)}
        evidence={'workflowRuns':[{'head_sha':'commit','name':'pages build and deployment','status':'completed','conclusion':'success'}],'onlineData':{'meta':1}}
        self.assertFalse(pipeline.verify_result(plan,'commit',evidence)['verified']);evidence['onlineTrends']=feed;self.assertTrue(pipeline.verify_result(plan,'commit',evidence)['verified'])


class TrendConflictTests(unittest.TestCase):
    def test_newer_remote_trend_is_preserved_during_rebase(self):
        n=dt.datetime(2026,10,19,15,5,tzinfo=UTC);local=failed_snapshot(n,'intraday','2026-10-19','local');remote=failed_snapshot(n+dt.timedelta(minutes=1),'intraday','2026-10-19','remote')
        with tempfile.TemporaryDirectory() as directory:
            root=pathlib.Path(directory);pipeline.write(root/'trading-trends.json',local);state={'trendsGeneratedAt':local['generatedAt']}
            with patch.object(pipeline,'ROOT',root):pipeline.reconcile_trends(state,remote)
            self.assertTrue(state['trendsSuperseded']);self.assertEqual(state['trendsRemoteGeneratedAt'],remote['generatedAt']);self.assertEqual(pipeline.read(root/'trading-trends.json'),local)
    def test_same_timestamp_different_trend_content_is_not_overwritten(self):
        n=dt.datetime(2026,10,19,15,5,tzinfo=UTC);local=failed_snapshot(n,'intraday','2026-10-19','local');remote=failed_snapshot(n,'intraday','2026-10-19','different')
        with tempfile.TemporaryDirectory() as directory:
            root=pathlib.Path(directory);pipeline.write(root/'trading-trends.json',local)
            with patch.object(pipeline,'ROOT',root),self.assertRaisesRegex(ValueError,'冲突'):pipeline.reconcile_trends({},remote)
