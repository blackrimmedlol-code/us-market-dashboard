#!/usr/bin/env python3
"""Bounded prepare/research/finalize/publish pipeline; connector and token transports.

The model only supplies a small news patch. Quotes, deadlines, validation, conflict
handling and deployment checks are implemented here. No LLM or trading API calls.
"""
import argparse
import base64
import copy
import datetime as dt
import hashlib
import json
import os
import pathlib
import subprocess
import sys
import time
import urllib.error
import urllib.request
import fcntl
from market_calendar import ROOT, NY, UTC, nominal, next_update, trading_day

REPO = 'blackrimmedlol-code/us-market-dashboard'
PAGE = 'https://blackrimmedlol-code.github.io/us-market-dashboard/'
WORK = ROOT / '.dashboard-run'
STATE = WORK / 'state.json'

def now():
    return dt.datetime.now(UTC)

def read(path):
    return json.loads(pathlib.Path(path).read_text())

def write(path, value):
    path = pathlib.Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
    temporary.replace(path)

def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()

def remaining(state):
    return (dt.datetime.fromisoformat(state['deadlineAt']) - now()).total_seconds()

def command(args, timeout=60, state=None, accept=(0,)):
    limit = min(timeout, remaining(state)) if state else timeout
    if limit <= 0:
        raise TimeoutError('运行已超过10分钟预算')
    result = subprocess.run(args, cwd=ROOT, text=True, capture_output=True, timeout=max(.1, limit))
    if result.returncode not in accept:
        raise RuntimeError((result.stderr or result.stdout or '校验失败')[-1600:])
    return result

def validate(state, regressions=False):
    command(['node', 'validate-data.mjs', 'data.json', str(WORK / 'previous.json')], state=state)
    if regressions:
        command(['node', '--test', 'dashboard-model.test.mjs', 'sector-pulse.test.mjs', 'schedule.test.mjs', 'pipeline.test.mjs'], state=state)
        command([sys.executable, '-m', 'unittest', 'discover', '-s', 'scripts', '-p', 'test_*.py'], state=state)
    result = command(['node', 'check-session.mjs', 'data.json', state['session'], state['marketDate']], state=state, accept=(0, 2))
    return json.loads(result.stdout)

def record(state, status, **extra):
    attempt = {key: state[key] for key in ['session', 'marketDate', 'startedAt', 'deadlineAt']}
    attempt.update(status=status, completedAt=now().isoformat(), **extra)
    write(ROOT / 'run-status.json', attempt)
    return attempt

def build_plan(state, phase='final', failed=False):
    paths = ['run-status.json'] if failed else ['data.json', 'run-status.json', read(ROOT / 'data.json')['meta']['evidencePath']]
    files = []
    for path in paths:
        content = (ROOT / path).read_text()
        files.append({'path': path, 'content': content})
    plan = {'repository': REPO, 'branch': 'main', 'phase': phase,
            'expectedHead': state.get('publishedHead') or state.get('baseHead'),
            'message': f"Update {state['marketDate']} {state['session']} {phase}",
            'files': files, 'allowForce': False, 'maxConflictRetries': 1,
            'dataDigest': None if failed else digest(read(ROOT / 'data.json')),
            'statusDigest': digest(read(ROOT / 'run-status.json')),
            'pageUrl': PAGE}
    write(WORK / 'publication.json', plan)
    return {'planPath': str(WORK / 'publication.json'), 'phase': phase,
            'paths': paths, 'expectedHead': plan['expectedHead'], 'status': 'ready-to-publish'}

def already_current(data, session, day, slot):
    meta = data.get('meta', {})
    # A partial first publication does not prevent the bounded final news pass.
    if meta.get('session') != session or meta.get('marketDate') != day or meta.get('updateStatus') == 'partial':
        return False
    if dt.datetime.fromisoformat(meta['updatedAt']) < slot - dt.timedelta(minutes=1):
        return False
    result = command(['node', 'check-session.mjs', 'data.json', session, day], accept=(0, 2))
    return json.loads(result.stdout).get('complete', False)

def wait_for_slot(slot, start):
    early = (slot - start).total_seconds()
    if early > 300:
        return None
    while early > 0:
        time.sleep(min(60, early))
        start = now()
        early = (slot - start).total_seconds()
    return start

def latest_closed_day(start):
    day = start.astimezone(NY).date()
    for _ in range(12):
        text = day.isoformat()
        if trading_day(text) and start >= nominal(text, 'close'):
            return text
        day -= dt.timedelta(days=1)
    raise ValueError('最近已结束交易日未核实')

def prepare(args):
    start = now()
    day = args.market_date or start.astimezone(NY).date().isoformat()
    if not trading_day(day):
        return {'skip': True, 'reason': '非有效交易日'}
    manual_close = getattr(args, 'backfill_close', False)
    if manual_close and (args.session != 'close' or day != latest_closed_day(start)):
        raise ValueError('手动补收盘仅允许最近已结束交易日')
    if not manual_close and day != start.astimezone(NY).date().isoformat():
        raise ValueError('定时入口只处理当前美东交易日，不回填旧时段')
    slot = nominal(day, args.session)
    start = wait_for_slot(slot, start)
    if start is None:
        return {'skip': True, 'reason': '尚未到本轮名义时点'}
    old = read(ROOT / 'data.json')
    if old.get('meta', {}).get('marketDate', '') > day:
        raise ValueError('拒绝用旧交易日覆盖较新的行情')
    if already_current(old, args.session, day, slot):
        return {'skip': True, 'reason': '本交易日同一时段已完整发布'}
    if STATE.exists():
        active = read(STATE)
        if active.get('phase') in ['prepare', 'quotes', 'final'] and remaining(active) > 0:
            return {'skip': True, 'reason': '已有同仓库更新正在进行，不重复启动'}
    state = {'session': args.session, 'marketDate': day, 'baseHead': args.base_head,
             'startedAt': start.isoformat(), 'deadlineAt': (start + dt.timedelta(seconds=600)).isoformat(),
             'nominalAt': slot.isoformat(), 'baseDigest': digest(old), 'phase': 'prepare'}
    write(STATE, state)
    write(WORK / 'previous.json', old)
    try:
        result = command([sys.executable, 'scripts/refresh-dashboard.py', '--session', args.session, '--market-date', day], timeout=240, state=state)
        (WORK / 'refresh.log').write_text(result.stdout)
        data = read(ROOT / 'data.json')
        data['meta'].update(newsReviewStatus='partial', automationEnabled=True)
        # Publication of verified numerical data happens BEFORE news research.
        write(ROOT / 'data.json', data)
        report = validate(state, regressions=True)
        data['meta'].update(updateStatus='partial', missing=report['missing'], publishedAt=now().isoformat())
        write(ROOT / 'data.json', data)
        state['newsDeadlineAt'] = min(now() + dt.timedelta(seconds=300), start + dt.timedelta(seconds=540)).isoformat()
        state['phase'] = 'quotes'
        write(STATE, state)
        record(state, 'partial', missing=report['missing'])
        summary = json.loads(command(['node', 'scripts/compact-summary.mjs'], state=state).stdout)
        return {**build_plan(state, 'quotes'), 'deadlineAt': state['deadlineAt'], 'newsDeadlineAt': state['newsDeadlineAt'], 'summary': summary}
    except Exception as error:
        # Preserve the previous data on quote/schema failure and publish failure status only.
        write(ROOT / 'data.json', old)
        state['phase'] = 'failed'
        write(STATE, state)
        record(state, 'failed', error=str(error)[:600])
        return {**build_plan(state, 'failed', failed=True), 'failed': True, 'error': str(error)[:600]}

def parse_date(value):
    stamp = dt.datetime.fromisoformat(value)
    return stamp if stamp.tzinfo else stamp.replace(tzinfo=UTC)

def apply_news(data, patch, state, finished):
    cutoff = parse_date(state['newsDeadlineAt'])
    accepted = patch and finished <= cutoff
    pulse = data.get('sectorPulse', {})
    names = [r['name'] for side in ['gainers', 'losers'] for r in pulse.get(side, [])]
    reviewed = set()
    if accepted:
        checked = parse_date(patch['checkedAt'])
        if not parse_date(state['startedAt']) <= checked <= finished:
            raise ValueError('新闻核实时间不属于本轮实际窗口')
        for key, item in patch.get('news', {}).items():
            if key not in ['memory', 'cloud', 'space', 'crypto']:
                raise ValueError('新闻目标超出四战场')
            if item is None:
                data.get('news', {}).pop(key, None)
            else:
                data.setdefault('news', {})[key] = item
        reviewed = set(patch.get('reviewedIndustries', []))
        for name, item in patch.get('sectorNews', {}).items():
            if name not in names:
                raise ValueError('不能研究或写入未入榜行业')
            pulse.setdefault('news', {})[name] = {**item, 'checkedAt': checked.isoformat()}
            reviewed.add(name)
        for name in reviewed:
            if name not in names or name not in pulse.get('news', {}):
                raise ValueError('已复核行业缺少新闻或原因待核实记录')
            pulse['news'][name]['checkedAt'] = checked.isoformat()
            pulse['news'][name].pop('reusedAt', None)
        sectors = set(patch.get('reviewedSectors', []))
        if sectors == {'memory', 'cloud', 'space', 'crypto'}:
            data['meta']['newsReviewStatus'] = 'complete'
            data['meta']['newsCheckedAt'] = checked.isoformat()
    # Same-day, unexpired event cache keeps the ORIGINAL research timestamp.
    for name in names:
        if name not in reviewed:
            item = pulse.get('news', {}).get(name)
            if not item:
                continue
            checked = parse_date(item['checkedAt'])
            age = (finished - checked).total_seconds()
            alive = age < 3600 if item['kind'] == 'unknown' else age < 10800 and parse_date(item['expiresAt']) > finished
            if 0 <= age and alive:
                item['reusedAt'] = finished.isoformat()
    if reviewed:
        pulse['researchAt'] = patch['checkedAt']
    cached = sum(bool(pulse.get('news', {}).get(n, {}).get('reusedAt')) for n in names)
    pulse['reviewStatus'] = 'cached' if cached == len(names) and names else 'complete' if len(reviewed) + cached == len(names) else 'partial'
    return bool(accepted)

def finalize(args):
    state = read(STATE)
    if state.get('phase') not in ['quotes', 'final']:
        raise ValueError('本轮尚未生成有效数值快照')
    if remaining(state) < 20:
        raise TimeoutError('仅保留已发布的数值快照；本轮10分钟预算已用尽')
    original = read(ROOT / 'data.json')
    data = copy.deepcopy(original)
    if data['meta'].get('priceBasis')=='premarket':
        data['sectorPulse']={'status':'unavailable','marketDate':data['meta']['marketDate'],'targetAsOf':data['meta']['asOf'],'asOf':None,'fetchedAt':now().isoformat(),'returnBasis':'daily','universe':'Finviz 全部细分行业（提供方口径）','universeCount':0,'sourceUrl':'https://finviz.com/groups.ashx?g=industry&v=140&o=-change','dateBasis':None,'rows':[],'gainers':[],'losers':[],'note':'盘前无可核实的全市场细分行业口径'}
    finished = now()
    patch = read(args.news_file) if args.news_file else None
    try:
        applied = apply_news(data, patch, state, finished)
        data['meta'].update(updatedAt=finished.isoformat(), nextUpdate=next_update(finished), publishedAt=finished.isoformat())
        write(ROOT / 'data.json', data)
        report = validate(state)
    except Exception:
        write(ROOT / 'data.json', original)
        raise
    data['meta'].update(updateStatus='complete' if report['complete'] else 'partial', missing=report['missing'])
    write(ROOT / 'data.json', data)
    state.update(phase='final', dataDigest=digest(data))
    write(STATE, state)
    record(state, data['meta']['updateStatus'], missing=report['missing'], newsPatchApplied=applied)
    return {**build_plan(state), 'complete': report['complete'], 'missing': report['missing'], 'newsPatchApplied': applied}

def merge_remote(candidate, remote):
    """A single conflict merge preserves unknown fields and newer remote snapshots."""
    if parse_date(remote['meta']['asOf']) > parse_date(candidate['meta']['asOf']):
        raise ValueError('远端已有更新行情；本轮不得覆盖')
    if (remote['meta']['marketDate'] == candidate['meta']['marketDate'] and remote['meta']['session'] == candidate['meta']['session']
            and parse_date(remote['meta']['updatedAt']) > parse_date(candidate['meta']['updatedAt'])):
        raise ValueError('同一时段远端内容更新；本轮不得覆盖')
    merged = {**copy.deepcopy(remote), **copy.deepcopy(candidate)}
    merged['meta'] = {**remote['meta'], **candidate['meta']}
    merged['assets'] = {s: {**remote.get('assets', {}).get(s, {}), **q} for s, q in candidate['assets'].items()}
    for key in ['news']:
        merged[key] = {**remote.get(key, {}), **candidate.get(key, {})}
    if parse_date(remote['meta']['asOf']) < parse_date(candidate['meta']['asOf']):
        merged['previous'] = {k: remote[k] for k in ['meta', 'assets', 'breadth']}
    return merged

def rebase(args):
    state = read(STATE)
    if state.get('conflictRetries', 0) >= 1:
        raise ValueError('已达到一次冲突重读合并上限')
    merged = merge_remote(read(ROOT / 'data.json'), read(args.remote_data))
    write(ROOT / 'data.json', merged)
    write(WORK / 'previous.json', read(args.remote_data))
    validate(state)
    state.update(publishedHead=args.remote_head, conflictRetries=1)
    write(STATE, state)
    return build_plan(state, state['phase'])

def request(method, path, value=None, token=None):
    url = 'https://api.github.com/repos/' + REPO + '/' + path
    headers = {'Accept': 'application/vnd.github+json', 'User-Agent': 'market-dashboard-v18.7'}
    if token:
        headers['Authorization'] = 'Bearer ' + token
    payload = json.dumps(value).encode() if value is not None else None
    req = urllib.request.Request(url, data=payload, headers=headers, method=method)
    limit = min(25, remaining(read(STATE))) if STATE.exists() else 25
    if limit <= 0:
        raise TimeoutError('运行预算已用尽')
    with urllib.request.urlopen(req, timeout=limit) as response:
        return json.load(response)

def publish(args):
    state = read(STATE)
    if args.commit_sha:
        state['publishedHead'] = args.commit_sha
        write(STATE, state)
        return {'recordedCommit': args.commit_sha, 'verified': False, 'next': 'verify'}
    plan = read(WORK / 'publication.json')
    token = os.environ.get('DASHBOARD_GITHUB_TOKEN') or os.environ.get('GH_TOKEN') or os.environ.get('GITHUB_TOKEN')
    if args.transport == 'connector' or not token:
        return {'transport': 'connector', 'planPath': str(WORK / 'publication.json'),
                'steps': ['fetch main commit and compare expectedHead', 'create blobs for exact plan files', 'create tree using current commit tree', 'create commit using expectedHead parent', 'update main force=false', 'record commit, then verify'],
                'maxConflictRetries': 1}
    for attempt in range(2):
        if remaining(state) < 20:
            raise TimeoutError('发布预算已用尽；不启动额外补跑')
        head = request('GET', 'commits/main', token=token)
        if plan.get('expectedHead') and head['sha'] != plan['expectedHead']:
            if state.get('conflictRetries', 0) >= 1:
                raise ValueError('远端再次变化，停止发布')
            encoded = request('GET', 'contents/data.json', token=token)
            remote = json.loads(base64.b64decode(encoded['content']))
            write(ROOT / 'data.json', merge_remote(read(ROOT / 'data.json'), remote))
            write(WORK / 'previous.json', remote)
            validate(state)
            state.update(publishedHead=head['sha'], conflictRetries=1)
            write(STATE, state)
            build_plan(state, plan['phase'])
            plan = read(WORK / 'publication.json')
        entries = []
        for item in plan['files']:
            blob = request('POST', 'git/blobs', {'content': item['content'], 'encoding': 'utf-8'}, token)
            entries.append({'path': item['path'], 'mode': '100644', 'type': 'blob', 'sha': blob['sha']})
        tree = request('POST', 'git/trees', {'base_tree': head['commit']['tree']['sha'], 'tree': entries}, token)
        commit = request('POST', 'git/commits', {'message': plan['message'], 'tree': tree['sha'], 'parents': [head['sha']]}, token)
        try:
            request('PATCH', 'git/refs/heads/main', {'sha': commit['sha'], 'force': False}, token)
            state['publishedHead'] = commit['sha']
            write(STATE, state)
            return {'commit': commit['sha'], 'verified': False, 'next': 'verify'}
        except urllib.error.HTTPError as error:
            if error.code not in [409, 422] or attempt:
                raise
    raise RuntimeError('发布失败')

def verify_result(plan, commit, evidence):
    runs = evidence.get('workflowRuns', [])
    matched = [r for r in runs if r.get('head_sha') == commit and r.get('name') == 'pages build and deployment']
    pages = any(r.get('status') == 'completed' and r.get('conclusion') == 'success' for r in matched)
    online = evidence.get('onlineData')
    same = online is not None and digest(online) == plan['dataDigest'] if plan.get('dataDigest') else digest(evidence.get('onlineStatus')) == plan.get('statusDigest')
    return {'commit': commit, 'pagesDeployed': pages, 'onlineMatches': same, 'verified': pages and same}

def verify(args):
    plan, state = read(WORK / 'publication.json'), read(STATE)
    commit = args.commit_sha or state.get('publishedHead')
    if not commit:
        raise ValueError('没有提交SHA，不能声称发布成功')
    if args.evidence:
        result = verify_result(plan, commit, read(args.evidence))
    else:
        token = os.environ.get('DASHBOARD_GITHUB_TOKEN') or os.environ.get('GH_TOKEN') or os.environ.get('GITHUB_TOKEN')
        result = {'verified': False}
        # One bounded verification window, no additional scheduled repair task.
        end = min(time.monotonic() + 90, time.monotonic() + max(0, remaining(state)))
        while time.monotonic() < end:
            runs = request('GET', 'actions/runs?per_page=20', token=token)['workflow_runs']
            path = 'data.json' if plan.get('dataDigest') else 'run-status.json'
            with urllib.request.urlopen(PAGE + path + '?v=' + str(int(time.time())), timeout=20) as response:
                online = json.load(response)
            result = verify_result(plan, commit, {'workflowRuns': runs, 'onlineData': online if plan.get('dataDigest') else None, 'onlineStatus': online})
            if result['verified']:
                break
            time.sleep(min(10, max(0, end - time.monotonic())))
    write(WORK / 'verification.json', result)
    if result.get('verified'):
        state['verifiedPhase'] = plan['phase']
        if plan['phase'] in ['final', 'failed']:
            state['phase'] = 'verified'
        write(STATE, state)
    return result

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='action', required=True)
    p = sub.add_parser('prepare')
    p.add_argument('--session', choices=['premarket', 'intraday', 'late', 'close'], required=True)
    p.add_argument('--market-date')
    p.add_argument('--backfill-close', action='store_true', help='手动补最近已结束交易日收盘；不用于定时任务')
    p.add_argument('--base-head', required=True)
    p = sub.add_parser('finalize')
    p.add_argument('--news-file')
    p = sub.add_parser('rebase')
    p.add_argument('--remote-data', required=True)
    p.add_argument('--remote-head', required=True)
    p = sub.add_parser('publish')
    p.add_argument('--transport', choices=['api', 'connector'], default='api')
    p.add_argument('--commit-sha')
    p = sub.add_parser('verify')
    p.add_argument('--commit-sha')
    p.add_argument('--evidence')
    args = parser.parse_args()
    try:
        WORK.mkdir(parents=True, exist_ok=True)
        with (WORK / 'lock').open('w') as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                print(json.dumps({'skip': True, 'reason': '统一入口已有进程运行'}))
                return 0
            result = globals()[args.action](args)
        print(json.dumps(result, ensure_ascii=False))
        if args.action == 'verify' and not result.get('verified'):
            return 2
        return 0
    except Exception as error:
        print(json.dumps({'ok': False, 'action': args.action, 'error': str(error)[:800]}, ensure_ascii=False))
        return 1

if __name__ == '__main__':
    sys.exit(main())
