import { readFileSync } from 'node:fs';
import model from './market-model.js';

const file = process.argv[2] || new URL('./data.json', import.meta.url).pathname;
const data = JSON.parse(readFileSync(file, 'utf8'));
const sessions = ['premarket', 'intraday', 'late', 'close'];
const targetOrder = model.TARGETS;
const actionOrder = ['MARKET', ...targetOrder];
const changeOrder = ['市场', ...targetOrder];
const snapshotOrder = ['SPY', 'QQQ', 'SOXX', ...targetOrder, 'BTC'];
const planStatuses = new Set(['等待触发', '已触发', '部分确认', '已确认', '失败突破', '剧本失效']);
const tradeTypes = new Set(['风险预算', '短线事件交易', '趋势交易', '中期逻辑观察', '仅观察']);
const confirmationStates = new Set(['confirmed', 'mixed', 'failed', 'unknown']);
const regimeCodes = new Set(['RISK_ON', 'SELECTIVE_RISK_ON', 'ROTATION_NEUTRAL', 'RISK_OFF', 'EVENT_LOCK']);
const breadthStates = new Set(['broad', 'selective', 'mixed', 'weak', 'unknown']);
const gateStates = new Set(['open', 'caution', 'locked']);
const outcomeStates = new Set(['open', 'triggered', 'invalidated', 'closed', 'expired']);
const impactFields = new Set(['regimeCode', 'planStatus', 'tradeType', 'permissions', 'trigger', 'invalidation', 'confidence']);
const newsDirectness = new Set(['行动级', '背景']);
const tones = new Set(['up', 'down', 'flat']);
const timeframeMethods = new Set(['direct', 'aggregate', 'structure', 'daily']);
const capitalKeys = ['endDemand', 'unitEconomics', 'capex', 'financing', 'price'];
const demandLoopKeys = ['industryDemand', 'ordersCommitments', 'deliveryUtilization', 'revenueConversion', 'marginCashFlow'];
const fundamentalLoopAssets = new Set(['DRAM', 'LITE', 'CIEN', 'CRDO', 'IREN', 'BE']);
const overbuildStates = new Set(['unknown', 'no_signal', 'early_warning', 'confirmed']);
const errors = [];
const warnings = [];
const fail = (path, message) => errors.push(`${path}: ${message}`);

if (Number(data?.meta?.schemaVersion) !== model.SCHEMA) fail('meta.schemaVersion', '必须为 15');
if (!sessions.includes(data?.meta?.latestSession)) fail('meta.latestSession', '不是合法时段');

for (const key of sessions) {
  const session = data[key];
  if (!session || session.available === false) continue;
  const base = key;
  if (!session.updatedAt) fail(`${base}.updatedAt`, '缺失');
  if (!session.largestChange) fail(`${base}.largestChange`, '缺失');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(session.sessionDate || '')) fail(`${base}.sessionDate`, '缺失美东交易日');
  for (const field of ['nominalAt', 'marketCloseAt']) if (!model.validTime(session[field])) fail(`${base}.${field}`, '必须是 ISO 时间');
  const quality = session.quality;
  if (!quality || !Array.isArray(quality.issues) || !quality.quotes || !model.validTime(quality.checkedAt)) fail(`${base}.quality`, '缺少结构化问题、行情或核验时间');
  else {
    quality.issues.forEach((issue, i) => {
      const path = `${base}.quality.issues[${i}]`;
      if (!issue.code || !issue.message || !['global', 'asset', 'metric'].includes(issue.scope) || !['info', 'warning', 'critical'].includes(issue.level) || !['execution', 'volume', 'linkage', 'reference'].includes(issue.effect)) fail(path, '非法分级提示');
      if (!Array.isArray(issue.assets) || !issue.assets.every(a => actionOrder.includes(a))) fail(path, '非法影响标的');
      if (issue.scope !== 'global' && !issue.assets?.length) fail(path, '局部问题必须写明影响范围');
      if (issue.scope === 'global' && issue.assets?.length) fail(path, '全局问题不得混入局部资产');
    });
    snapshotOrder.forEach(symbol => {
      const q = quality.quotes[symbol], path = `${base}.quality.quotes.${symbol}`;
      if (!q || !['verified', 'missing', 'conflict', 'unverified'].includes(q.status)) { fail(path, '缺失或非法行情状态'); return; }
      if (q.status === 'missing' && q.price != null) fail(path, '缺失报价必须为 null');
      if (q.status === 'verified' && (!model.positive(q.price) || !model.validTime(q.asOf) || !q.sourceUrl)) fail(path, '已核实报价必须有正价格、时间与来源');
      if (q.isFinal && (q.session !== 'regular' || ![q.open, q.high, q.low, q.price, q.volume].every(model.positive) || model.marketDate(q.asOf) !== q.marketDate || Date.parse(q.asOf) < Date.parse(session.marketCloseAt))) fail(path, '正式日线必须为本交易日收盘后完整 OHLCV');
      if ([q.open, q.high, q.low, q.price].every(model.positive) && (q.high < Math.max(q.open, q.price) || q.low > Math.min(q.open, q.price) || q.low > q.high)) fail(path, 'OHLC 上下界矛盾');
      const snapshot = session.snapshot?.find(x => x.symbol === symbol), watch = session.watchlist?.find(x => x.symbol === symbol);
      if (snapshot && snapshot.price !== q.price) fail(path, '与 snapshot 价格不一致');
      if (watch && watch.price !== q.price) fail(path, '与 watchlist 价格不一致');
    });
  }
  if (!['pending', 'partial', 'final', 'snapshot'].includes(session.completion?.status)) fail(`${base}.completion`, '缺失完成状态');
  if (key === 'close' && (session.completion?.status === 'final' || session.decisionGate?.closeFinal)) {
    const result = model.completion(data, key, session.sessionDate);
    if (!result.complete) fail(`${base}.completion`, result.errors.join('；'));
  }
  if (!regimeCodes.has(session.regimeCode)) fail(`${base}.regimeCode`, `非法值 ${session.regimeCode ?? 'null'}`);
  if (!breadthStates.has(session.breadthState)) fail(`${base}.breadthState`, `非法值 ${session.breadthState ?? 'null'}`);
  const gate = session.decisionGate;
  if (!gate) fail(`${base}.decisionGate`, '缺失');
  else {
    if (!gate.quoteAsOf || Number.isNaN(Date.parse(gate.quoteAsOf))) fail(`${base}.decisionGate.quoteAsOf`, '必须是 ISO 时间');
    if (!gate.validUntil || Number.isNaN(Date.parse(gate.validUntil))) fail(`${base}.decisionGate.validUntil`, '必须是 ISO 时间');
    if (!gateStates.has(gate.status)) fail(`${base}.decisionGate.status`, '非法值');
    for (const boolKey of ['sourceConflict', 'volumeComplete', 'closeFinal']) {
      if (typeof gate[boolKey] !== 'boolean') fail(`${base}.decisionGate.${boolKey}`, '必须是布尔值');
    }
  }
  if (!Array.isArray(session.eventCalendar)) fail(`${base}.eventCalendar`, '必须是数组');
  else session.eventCalendar.forEach((event, index) => {
    const path = `${base}.eventCalendar[${index}]`;
    if (!event.id || !event.label || !event.eventDate) fail(path, '缺少 id / label / eventDate');
    if (!Array.isArray(event.affectedAssets) || !event.affectedAssets.every((asset) => actionOrder.includes(asset))) fail(`${path}.affectedAssets`, '包含非法标的');
    if (event.startsAt && Number.isNaN(Date.parse(event.startsAt))) fail(`${path}.startsAt`, '必须是 ISO 时间');
  });
  if (!session.horizons || typeof session.horizons !== 'object') fail(`${base}.horizons`, '缺失');
  for (const asset of actionOrder) {
    const short = session.horizons?.[asset]?.short;
    const path = `${base}.horizons.${asset}.short`;
    if (!short) { fail(path, '缺失'); continue; }
    if (!planStatuses.has(short.planStatus)) fail(`${path}.planStatus`, `非法值 ${short.planStatus ?? 'null'}`);
    if (!tradeTypes.has(short.tradeType)) fail(`${path}.tradeType`, `非法值 ${short.tradeType ?? 'null'}`);
    for (const evidence of ['price', 'volume', 'linkage']) {
      if (!confirmationStates.has(short.confirmations?.[evidence]?.state)) fail(`${path}.confirmations.${evidence}.state`, '非法或缺失');
    }
    for (const field of ['holdingPlan', 'entryPlan']) if (!short[field]) fail(`${path}.${field}`, '必须区分已有持仓与新增仓位');
    const volume = short.confirmations?.volume;
    if (volume?.state === 'confirmed') {
      const benchmark = volume.benchmark;
      if (!benchmark || !model.positive(benchmark.value) || !model.positive(benchmark.current) || !benchmark.basis || !benchmark.asOf || !benchmark.sourceUrl) fail(`${path}.confirmations.volume`, '量能确认缺少可审计比较基准');
      if (key !== 'close' && benchmark?.basis !== 'same-time') fail(`${path}.confirmations.volume.benchmark`, '盘中只能与同时间进度比较');
    }
  }
  const watchOrder = (session.watchlist || []).map((item) => item.symbol).filter((symbol) => targetOrder.includes(symbol));
  if (JSON.stringify(watchOrder) !== JSON.stringify(targetOrder)) fail(`${base}.watchlist`, `顺序必须为 ${targetOrder.join(' / ')}`);
  for (const asset of targetOrder) {
    const item = (session.watchlist || []).find((candidate) => candidate.symbol === asset);
    const path = `${base}.watchlist.${asset}.demandLoop`;
    if (!item) continue;
    for (const timeframe of ['15m', '30m', '1h', '4h', '1d']) {
      if (!['bull', 'bear', 'neutral', 'unknown'].includes(item.timeframes?.[timeframe])) fail(`${base}.watchlist.${asset}.timeframes.${timeframe}`, '非法或缺失');
      if (!timeframeMethods.has(item.timeframeMethods?.[timeframe])) fail(`${base}.watchlist.${asset}.timeframeMethods.${timeframe}`, '非法或缺失');
      if (!item.timeframeNotes?.[timeframe]) fail(`${base}.watchlist.${asset}.timeframeNotes.${timeframe}`, '缺失证据说明');
    }
    if (fundamentalLoopAssets.has(asset)) {
      const actualKeys = (item.demandLoop || []).map((node) => node.key);
      if (JSON.stringify(actualKeys) !== JSON.stringify(demandLoopKeys)) fail(path, `必须是纯基本面兑现链：${demandLoopKeys.join(' / ')}`);
      (item.demandLoop || []).forEach((node, index) => {
        if (!node.label || !node.state || !node.tone || !node.note) fail(`${path}[${index}]`, '缺少 label / state / tone / note');
      });
    } else if (Array.isArray(item.demandLoop) && item.demandLoop.length) {
      fail(path, 'SPCX / MSTR 只有确有独立基本面兑现链时才允许写入，当前应为空');
    }
  }
  const cycle = session.aiCapitalCycle;
  if (!cycle) fail(`${base}.aiCapitalCycle`, '缺失');
  else {
    const actualKeys = (cycle.items || []).map((item) => item.key);
    if (JSON.stringify(actualKeys) !== JSON.stringify(capitalKeys)) fail(`${base}.aiCapitalCycle.items`, `顺序必须为 ${capitalKeys.join(' / ')}`);
    if (!cycle.demandFormula) fail(`${base}.aiCapitalCycle.demandFormula`, '缺失');
    (cycle.items || []).forEach((item, index) => {
      if (!item.label || !item.state || !item.tone || !item.evidence || !item.invalidation) fail(`${base}.aiCapitalCycle.items[${index}]`, '缺少 label / state / tone / evidence / invalidation');
    });
    const overbuild = cycle.overbuild;
    if (!overbuild) fail(`${base}.aiCapitalCycle.overbuild`, '缺失');
    else {
      if (!overbuildStates.has(overbuild.stateCode)) fail(`${base}.aiCapitalCycle.overbuild.stateCode`, '非法值');
      if (!overbuild.state || !overbuild.tone || !overbuild.nextTrigger) fail(`${base}.aiCapitalCycle.overbuild`, '缺少 state / tone / nextTrigger');
      if (!Array.isArray(overbuild.warningEvidence) || !Array.isArray(overbuild.offsettingEvidence)) fail(`${base}.aiCapitalCycle.overbuild`, 'warningEvidence / offsettingEvidence 必须是数组');
    }
  }
  const actualSnapshotOrder = (session.snapshot || []).map((item) => item.symbol);
  if (JSON.stringify(actualSnapshotOrder) !== JSON.stringify(snapshotOrder)) fail(`${base}.snapshot`, `顺序必须为 ${snapshotOrder.join(' / ')}`);
  const matrixOrder = (session.matrix || []).map((item) => item.asset === '市场' ? 'MARKET' : item.asset);
  if (JSON.stringify(matrixOrder) !== JSON.stringify(actionOrder)) fail(`${base}.matrix`, `顺序必须为 MARKET / ${targetOrder.join(' / ')}`);
  const oddsOrder = (session.odds || []).map((item) => `${item?.asset}:${item?.window}`);
  const expectedOddsOrder = targetOrder.flatMap((asset) => [`${asset}:60D`, `${asset}:252D`]);
  if (JSON.stringify(oddsOrder) !== JSON.stringify(expectedOddsOrder)) fail(`${base}.odds`, `每个标的必须依次包含 60D / 252D，顺序为 ${targetOrder.join(' / ')}`);
  (session.odds || []).forEach((item, index) => {
    const path = `${base}.odds[${index}]`;
    const target = item.window === '252D' ? 252 : item.window === '60D' ? 60 : null;
    if (!target) fail(`${path}.window`, '只能为 60D / 252D');
    if (item.percentile == null) {
      if (item.referencePrice != null) warnings.push(`${path}: percentile 为空但 referencePrice 非空，页面仍按待计算处理`);
      if (!item.sampleNote) fail(`${path}.sampleNote`, '分位为空时必须解释原因');
    } else {
      if (!Number.isFinite(Number(item.percentile)) || Number(item.percentile) < 0 || Number(item.percentile) > 100) fail(`${path}.percentile`, '必须为 0–100');
      if (!(Number(item.sampleSize) > 0)) fail(`${path}.sampleSize`, '有效分位必须有真实样本数');
      for (const field of ['asOf', 'basis', 'source']) if (!item[field]) fail(`${path}.${field}`, '有效分位缺失');
      if (!(Number(item.referencePrice) > 0)) fail(`${path}.referencePrice`, '有效分位必须有参考价');
      if (Number(item.sampleSize) < target && !item.proxy && !item.sampleNote) fail(`${path}.sampleNote`, '不足完整窗口时必须明确样本边界');
      if (item.proxy && !item.components) fail(`${path}.components`, '代理分位必须注明组成');
    }
  });
  if (!Array.isArray(session.news)) fail(`${base}.news`, '必须是数组');
  else session.news.forEach((item, index) => {
    const path = `${base}.news[${index}]`;
    if (typeof item.material !== 'boolean') fail(`${path}.material`, '必须是布尔值');
    if (!newsDirectness.has(item.directness)) fail(`${path}.directness`, '只能为 行动级 / 背景');
    if (!tones.has(item.tone)) fail(`${path}.tone`, '只能为 up / down / flat');
    if (!item.impact) fail(`${path}.impact`, '缺失对行动的影响说明');
    if (!Array.isArray(item.impactFields) || !item.impactFields.every((field) => impactFields.has(field))) fail(`${path}.impactFields`, '含非法字段');
    if (item.material && (item.directness !== '行动级' || item.impactFields.length === 0)) fail(path, '行动级新闻必须有影响字段且 directness=行动级');
    if (!item.material && (item.directness !== '背景' || item.impactFields.length)) fail(path, '背景新闻不得声明行动影响字段');
  });
  const extendedOrder = (session.extendedHours || []).filter(Boolean).map((item) => item.symbol).filter((symbol) => targetOrder.includes(symbol));
  if (extendedOrder.length && JSON.stringify(extendedOrder) !== JSON.stringify(targetOrder)) fail(`${base}.extendedHours`, `存在时必须覆盖并按 ${targetOrder.join(' / ')} 排序`);
  if (!Array.isArray(session.changes) || session.changes.length !== 9) fail(`${base}.changes`, '必须覆盖市场与八个标的');
  else {
    const actualChangeOrder = session.changes.map((change) => change.asset);
    if (JSON.stringify(actualChangeOrder) !== JSON.stringify(changeOrder)) fail(`${base}.changes`, `顺序必须为 ${changeOrder.join(' / ')}`);
    session.changes.forEach((change, index) => {
    const path = `${base}.changes[${index}]`;
    if (typeof change.material !== 'boolean') fail(`${path}.material`, '必须是布尔值');
    if (!Array.isArray(change.impactFields) || !change.impactFields.every((field) => impactFields.has(field))) fail(`${path}.impactFields`, '含非法字段');
    if (change.material && change.impactFields.length === 0) fail(`${path}.impactFields`, '行动级变化不能为空');
    if (!change.material && change.impactFields.length) warnings.push(`${path}: 非行动级变化仍声明了影响字段`);
    });
  }
}

const latestReviewAssets = (data.reviews?.[0]?.assets || []).map((item) => item.asset === '市场' ? 'MARKET' : item.asset);
if (JSON.stringify(latestReviewAssets) !== JSON.stringify(actionOrder)) fail('reviews[0].assets', `顺序必须为 MARKET / ${targetOrder.join(' / ')}`);
const mediumOrder = (data.mediumLedger || []).map((item) => item.asset === '市场' ? 'MARKET' : item.asset);
if (JSON.stringify(mediumOrder) !== JSON.stringify(actionOrder)) fail('mediumLedger', `顺序必须为 MARKET / ${targetOrder.join(' / ')}`);

if (!Array.isArray(data.decisionLedger)) fail('decisionLedger', '必须是数组');
else {
  const ids = new Set();
  data.decisionLedger.forEach((call, index) => {
    const path = `decisionLedger[${index}]`;
    if (!call.callId || ids.has(call.callId)) fail(`${path}.callId`, '缺失或重复');
    ids.add(call.callId);
    if (!actionOrder.includes(call.asset)) fail(`${path}.asset`, '非法标的');
    if (!regimeCodes.has(call.regimeCode)) fail(`${path}.regimeCode`, '非法值');
    if (!tradeTypes.has(call.setupType)) fail(`${path}.setupType`, '非法值');
    if (!planStatuses.has(call.planStatus)) fail(`${path}.planStatus`, '非法值');
    if (!outcomeStates.has(call.outcome?.status)) fail(`${path}.outcome.status`, '非法值');
    const outcome = call.outcome || {};
    if (outcome.status === 'open' && (outcome.triggeredAt || outcome.invalidatedAt || outcome.evaluatedAt)) fail(`${path}.outcome`, 'open 不得带触发、失效或评估时间');
    if (outcome.status === 'triggered' && !outcome.triggeredAt) fail(`${path}.outcome.triggeredAt`, 'triggered 必须有触发时间');
    if (outcome.status === 'invalidated' && !outcome.invalidatedAt && !outcome.evaluatedAt) fail(`${path}.outcome`, 'invalidated 必须有失效或评估时间');
    if (['closed', 'expired'].includes(outcome.status) && !outcome.evaluatedAt) fail(`${path}.outcome.evaluatedAt`, `${outcome.status} 必须有评估时间`);
    if (['失败突破', '剧本失效'].includes(call.planStatus) && ['open', 'triggered'].includes(outcome.status)) fail(`${path}.planStatus`, '失败剧本不能仍处于开放或触发未结状态');
    const immutable = ['trigger', 'invalidation', 'referenceAt', 'referencePrice', 'setupType'];
    if (!call.originalPlan || !model.validTime(call.originalPlan.capturedAt)) fail(`${path}.originalPlan`, '缺失原判断快照');
    else for (const field of immutable) if (call.originalPlan[field] !== call[field]) fail(`${path}.${field}`, '原判断不可改写，变更应新建 callId');
    if (call.supersededBy && !data.decisionLedger.some(x => x.callId === call.supersededBy && x.asset === call.asset && x.callId !== call.callId)) fail(`${path}.supersededBy`, '必须引用同标的另一个判断');
    if (!call.supersededBy && call.sessionDate === data.meta?.sessionDate && call.session === data.meta?.latestSession && ['open', 'triggered'].includes(outcome.status)) {
      const active = data[call.session]?.horizons?.[call.asset]?.short;
      if (!active) fail(`${path}.session`, '最新开放判断没有对应的 horizons 短线剧本');
      else {
        if (call.planStatus !== active.planStatus) fail(`${path}.planStatus`, '必须与最新 horizons 当前剧本一致');
        if (call.trigger !== active.trigger) fail(`${path}.trigger`, '必须与最新 horizons 当前剧本一致');
        if (call.invalidation !== active.invalidation) fail(`${path}.invalidation`, '必须与最新 horizons 当前剧本一致');
      }
    }
  });
}

if (process.argv[3]) {
  const previous = JSON.parse(readFileSync(process.argv[3], 'utf8'));
  for (const old of previous.decisionLedger || []) {
    const current = data.decisionLedger?.find(c => c.callId === old.callId);
    if (!current) { fail(`decisionLedger.${old.callId}`, '历史判断不可删除'); continue; }
    for (const field of ['asset', 'trigger', 'invalidation', 'referenceAt', 'referencePrice', 'setupType', 'session', 'sessionDate']) if (JSON.stringify(old[field]) !== JSON.stringify(current[field])) fail(`decisionLedger.${old.callId}.${field}`, '与写前原始判断不同');
    if (old.originalPlan && JSON.stringify(old.originalPlan) !== JSON.stringify(current.originalPlan)) fail(`decisionLedger.${old.callId}.originalPlan`, '原始快照不可改写');
  }
}

if (warnings.length) console.warn(`WARNINGS (${warnings.length})\n${warnings.join('\n')}`);
if (errors.length) {
  console.error(`INVALID (${errors.length})\n${errors.join('\n')}`);
  process.exit(1);
}
console.log(`VALID schema v15 · ${sessions.filter((key) => data[key]?.available !== false).length} sessions · ${data.decisionLedger.length} calls`);
