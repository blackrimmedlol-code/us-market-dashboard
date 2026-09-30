import copy
import datetime as dt
import importlib.util
import json
import pathlib
import subprocess
import tempfile
import shutil
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = pathlib.Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('pipeline', ROOT / 'scripts/update-session.py')
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)
from refresh_sectors import attach_core_members
from market_calendar import nominal, next_update, trading_day

class PipelineTests(unittest.TestCase):
    def setUp(self):
        self.data = json.loads((ROOT / 'fixtures/pipeline-data.json').read_text())

    def test_calendar_holidays_and_dst(self):
        self.assertFalse(trading_day('2026-11-26'))
        self.assertEqual(nominal('2026-09-30', 'premarket').astimezone(dt.timezone.utc).hour, 13)
        self.assertEqual(nominal('2026-11-02', 'premarket').astimezone(dt.timezone.utc).hour, 14)
        self.assertEqual(next_update(dt.datetime(2026, 11, 26, 20, tzinfo=dt.timezone.utc))['marketDate'], '2026-11-27')

    def test_conflict_merge_preserves_unknown_fields_and_refuses_newer_quotes(self):
        remote = copy.deepcopy(self.data)
        remote['retained'] = {'extra': 1}
        remote['meta']['unknown'] = True
        merged = p.merge_remote(self.data, remote)
        self.assertEqual(merged['retained'], {'extra': 1})
        self.assertTrue(merged['meta']['unknown'])
        remote['meta']['asOf'] = '2099-01-01T20:00:00Z'
        with self.assertRaises(ValueError):
            p.merge_remote(self.data, remote)

    def test_news_budget_expiry_does_not_forge_research_timestamp(self):
        d = copy.deepcopy(self.data)
        original = d['meta'].get('newsCheckedAt')
        d['meta']['newsReviewStatus'] = 'partial'
        state = {'startedAt': '2026-09-29T20:10:00Z', 'newsDeadlineAt': '2026-09-29T20:20:00Z'}
        patch_data = {'checkedAt': '2026-09-29T20:19:00Z', 'reviewedSectors': ['memory', 'cloud', 'space', 'crypto']}
        accepted = p.apply_news(d, patch_data, state, dt.datetime(2026, 9, 29, 20, 25, tzinfo=dt.timezone.utc))
        self.assertFalse(accepted)
        self.assertEqual(d['meta'].get('newsCheckedAt'), original)
        self.assertEqual(d['meta']['newsReviewStatus'], 'partial')

    def test_deployment_verification_requires_exact_commit_and_online_content(self):
        plan = {'dataDigest': p.digest(self.data)}
        run = {'head_sha': 'expected', 'name': 'pages build and deployment', 'status': 'completed', 'conclusion': 'success'}
        evidence = {'workflowRuns': [run], 'onlineData': self.data}
        self.assertTrue(p.verify_result(plan, 'expected', evidence)['verified'])
        self.assertFalse(p.verify_result(plan, 'other', evidence)['verified'])
        changed = copy.deepcopy(evidence)
        changed['onlineData']['meta']['marketDate'] = '2000-01-01'
        self.assertFalse(p.verify_result(plan, 'expected', changed)['verified'])

    def test_same_day_member_cache_avoids_requests_and_keeps_original_checked_at(self):
        now = dt.datetime(2026, 9, 29, 20, tzinfo=dt.timezone.utc)
        cached = {'status': 'verified', 'selection': 'optionable-marketcap', 'checkedAt': '2026-09-29T15:00:00Z',
                  'symbols': ['MU'], 'sourceUrl': 'https://finviz.com/screener.ashx?f=ind_semiconductors'}
        pulse = {'marketDate': '2026-09-29', 'gainers': [{'name': 'Semiconductors'}], 'losers': []}
        with patch('refresh_sectors.core_members') as fetch:
            attach_core_members(pulse, {'Semiconductors': cached}, now)
            fetch.assert_not_called()
        self.assertEqual(pulse['coreTickers']['Semiconductors']['checkedAt'], cached['checkedAt'])
        self.assertTrue(pulse['coreTickers']['Semiconductors']['cached'])

    def test_previous_day_or_failed_cache_is_refreshed(self):
        now = dt.datetime(2026, 9, 30, 20, tzinfo=dt.timezone.utc)
        pulse = {'marketDate': '2026-09-30', 'gainers': [{'name': 'Semiconductors'}], 'losers': []}
        cached = {'status': 'unavailable', 'checkedAt': '2026-09-30T15:00:00Z', 'symbols': []}
        with patch('refresh_sectors.core_members', return_value=cached) as fetch:
            attach_core_members(pulse, {'Semiconductors': cached}, now)
            fetch.assert_called_once_with('Semiconductors')
        self.assertFalse(pulse['coreTickers']['Semiconductors']['cached'])

    def test_two_phase_pipeline_publishes_quotes_before_news_and_verifies_exact_content(self):
        # Replay recorded numerical observations, with all external I/O mocked.
        # This exercises the actual CLI stages without creating a GitHub commit.
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            for path in ROOT.rglob('*'):
                if path.is_file() and '__pycache__' not in path.parts and '.dashboard-run' not in path.parts:
                    target = root / path.relative_to(ROOT)
                    target.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copyfile(path, target)
            old = {**self.data, **self.data['previous']}
            old.pop('previous', None)
            old['sectorPulse'] = {**self.data['sectorPulse'], 'status': 'unavailable', 'marketDate': old['meta']['marketDate'],
                                  'targetAsOf': old['meta']['asOf'], 'note': 'recorded prior window', 'news': {}}
            p.write(root / 'data.json', old)
            candidate = copy.deepcopy(self.data)
            candidate['meta']['updatedAt'] = '2026-09-29T20:25:00Z'
            clock = [dt.datetime(2026, 9, 29, 20, 25, tzinfo=dt.timezone.utc)]
            original_command = p.command
            calls, head = [], ['1' * 40]

            def command(arguments, **kwargs):
                if 'scripts/refresh-dashboard.py' in arguments:
                    p.write(root / 'data.json', candidate)
                    p.write(root / candidate['meta']['evidencePath'], {'recorded': True})
                    return subprocess.CompletedProcess(arguments, 0, '{}', '')
                if '--test' in arguments or 'unittest' in arguments:
                    return subprocess.CompletedProcess(arguments, 0, '', '')
                return original_command(arguments, **kwargs)

            def api(method, path, value=None, token=None):
                calls.append((method, path, value))
                if path == 'commits/main':
                    return {'sha': head[0], 'commit': {'tree': {'sha': 'tree'}}}
                if path == 'git/blobs':
                    return {'sha': p.digest(value)}
                if path == 'git/trees':
                    return {'sha': 'tree-next'}
                if path == 'git/commits':
                    return {'sha': '2' * 40 if head[0] == '1' * 40 else '3' * 40}
                if path == 'git/refs/heads/main':
                    self.assertFalse(value['force'])
                    head[0] = value['sha']
                    return {'ref': 'refs/heads/main'}
                raise AssertionError(path)

            with patch.object(p, 'ROOT', root), patch.object(p, 'WORK', root / '.dashboard-run'), patch.object(p, 'STATE', root / '.dashboard-run/state.json'), \
                    patch.object(p, 'now', side_effect=lambda: clock[0]), patch.object(p, 'command', side_effect=command), \
                    patch.object(p, 'request', side_effect=api), patch.dict(p.os.environ, {'DASHBOARD_GITHUB_TOKEN': 'test-only-no-network'}):
                prepared = p.prepare(SimpleNamespace(market_date='2026-09-29', session='close', base_head=head[0]))
                self.assertEqual(prepared['phase'], 'quotes')
                self.assertEqual(p.read(root / 'data.json')['meta']['updateStatus'], 'partial')
                first = p.publish(SimpleNamespace(commit_sha=None, transport='api'))
                evidence = root / 'verification-input.json'
                p.write(evidence, {'workflowRuns': [{'head_sha': first['commit'], 'name': 'pages build and deployment', 'status': 'completed', 'conclusion': 'success'}], 'onlineData': p.read(root / 'data.json')})
                self.assertTrue(p.verify(SimpleNamespace(commit_sha=first['commit'], evidence=str(evidence)))['verified'])
                self.assertEqual(p.read(p.STATE)['phase'], 'quotes')
                clock[0] += dt.timedelta(minutes=2)
                news = root / 'news.json'
                p.write(news, {'checkedAt': '2026-09-29T20:26:00Z', 'reviewedSectors': ['memory', 'cloud', 'space', 'crypto'],
                               'reviewedIndustries': [r['name'] for side in ['gainers', 'losers'] for r in candidate['sectorPulse'][side]]})
                final = p.finalize(SimpleNamespace(news_file=str(news)))
                self.assertTrue(final['complete'])
                second = p.publish(SimpleNamespace(commit_sha=None, transport='api'))
                self.assertNotEqual(first['commit'], second['commit'])
                p.write(evidence, {'workflowRuns': [{'head_sha': second['commit'], 'name': 'pages build and deployment', 'status': 'completed', 'conclusion': 'success'}], 'onlineData': p.read(root / 'data.json')})
                self.assertTrue(p.verify(SimpleNamespace(commit_sha=second['commit'], evidence=str(evidence)))['verified'])
                self.assertEqual(p.read(p.STATE)['phase'], 'verified')
                self.assertEqual(len([c for c in calls if c[1] == 'git/refs/heads/main']), 2)

    def test_invalid_news_patch_rolls_back_to_the_valid_quote_publication(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            original = copy.deepcopy(self.data)
            original['meta']['newsReviewStatus'] = 'partial'
            p.write(root / 'data.json', original)
            state = {'phase': 'quotes', 'session': 'close', 'marketDate': '2026-09-29',
                     'startedAt': '2026-09-29T20:25:00Z', 'deadlineAt': '2026-09-29T20:35:00Z', 'newsDeadlineAt': '2026-09-29T20:30:00Z'}
            p.write(root / 'state.json', state)
            bad = root / 'news.json'
            p.write(bad, {'checkedAt': '2026-09-29T20:26:00Z', 'news': {'memory': {'text': 'invalid'}}})
            with patch.object(p, 'ROOT', root), patch.object(p, 'STATE', root / 'state.json'), \
                    patch.object(p, 'now', return_value=dt.datetime(2026, 9, 29, 20, 27, tzinfo=dt.timezone.utc)), \
                    patch.object(p, 'validate', side_effect=ValueError('invalid provenance')):
                with self.assertRaises(ValueError):
                    p.finalize(SimpleNamespace(news_file=str(bad)))
            self.assertEqual(p.read(root / 'data.json'), original)

if __name__ == '__main__':
    unittest.main()
