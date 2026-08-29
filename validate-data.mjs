import { readFileSync } from 'node:fs';

const file = process.argv[2] || new URL('./data.json', import.meta.url).pathname;
const data = JSON.parse(readFileSync(file, 'utf8'));
const sessions = ['premarket', 'intraday', 'late', 'close'];
const targetOrder = ['DRAM', 'LITE', 'IREN', 'BE', 'SPCX', 'MSTR'];
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
const capitalKeys = ['endDemand', 'unitEconomics', 'capex', 'financing', 'price'];
const demandLoopKeys = ['industryDemand', 'ordersCommitments', 'deliveryUtilization', 'revenueConversion', 'marginCashFlow'];
const fundamentalLoopAssets = new Set(['DRAM', 'LITE', 'IREN', 'BE']);
const overbuildStates = new Set(['unknown', 'no_signal', 'early_warning', 'confirmed']);
const errors = [];
const warnings = [];
const fail = (path, message) => errors.push(`${path}: ${message}`);

if (Number(data?.meta?.schemaVersion) !== 13) fail('meta.schemaVersion', '必须为 13');
if (!sessions.includes(data?.meta?.latestSession)) fail('meta.latestSession', '不是合法时段');

for (const key of sessions) {
  const session = data[key];
  if (!session || session.available === false) continue;
  const base = key;
  if (!session.updatedAt) fail(`${base}.updatedAt`, '缺失');
  if (!session.largestChange) fail(`${base}.largestChange`, '缺失');
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
  }
  const watchOrder = (session.watchlist || []).map((item) => item.symbol).filter((symbol) => targetOrder.includes(symbol));
  if (JSON.stringify(watchOrder) !== JSON.stringify(targetOrder)) fail(`${base}.watchlist`, `顺序必须为 ${targetOrder.join(' / ')}`);
  for (const asset of targetOrder) {
    const item = (session.watchlist || []).find((candidate) => candidate.symbol === asset);
    const path = `${base}.watchlist.${asset}.demandLoop`;
    if (!item) continue;
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
  const extendedOrder = (session.extendedHours || []).filter(Boolean).map((item) => item.symbol).filter((symbol) => targetOrder.includes(symbol));
  if (extendedOrder.length && JSON.stringify(extendedOrder) !== JSON.stringify(targetOrder)) fail(`${base}.extendedHours`, `存在时必须覆盖并按 ${targetOrder.join(' / ')} 排序`);
  if (!Array.isArray(session.changes) || session.changes.length !== 7) fail(`${base}.changes`, '必须覆盖市场与六个标的');
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
  });
}

if (warnings.length) console.warn(`WARNINGS (${warnings.length})\n${warnings.join('\n')}`);
if (errors.length) {
  console.error(`INVALID (${errors.length})\n${errors.join('\n')}`);
  process.exit(1);
}
console.log(`VALID schema v13 · ${sessions.filter((key) => data[key]?.available !== false).length} sessions · ${data.decisionLedger.length} calls`);
