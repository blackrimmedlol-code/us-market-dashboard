/* Shared, deterministic data-quality rules. Used by the page and the write checker. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MarketModel = factory();
})(typeof window === 'object' ? window : this, function () {
  'use strict';
  var SCHEMA = 15;
  var TARGETS = ['DRAM', 'LITE', 'CIEN', 'CRDO', 'IREN', 'BE', 'SPCX', 'MSTR'];
  var ACTIONS = ['MARKET'].concat(TARGETS);
  var QUOTES = ['SPY', 'QQQ', 'SOXX'].concat(TARGETS, ['BTC']);
  var REQUIRED_CLOSE = QUOTES.filter(function (s) { return s !== 'BTC'; });
  function positive(value) { return typeof value === 'number' && Number.isFinite(value) && value > 0; }
  function validTime(value) { return typeof value === 'string' && Number.isFinite(Date.parse(value)); }
  function marketDate(value) {
    if (!validTime(value)) return null;
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
  }
  function unique(issues) {
    var seen = new Set();
    return issues.filter(function (x) { var id = x.code + ':' + x.message; if (seen.has(id)) return false; seen.add(id); return true; });
  }
  function issue(code, message, scope, assets, effect, level) {
    return { code: code, message: message, scope: scope || 'global', assets: assets || [], effect: effect || 'execution', level: level || 'critical' };
  }
  function issuesFor(b, asset, options) {
    var opts = options || {}, quality = b.quality || {}, issues = (quality.issues || []).filter(function (x) {
      return x.scope === 'global' || (x.assets || []).indexOf(asset) >= 0;
    });
    if (opts.schemaVersion !== SCHEMA) issues.push(issue('SCHEMA', '数据契约不匹配，执行判断暂停'));
    if (!b.horizons || !b.horizons[asset] || !b.horizons[asset].short) issues.push(issue('PLAN_MISSING', '本标的剧本缺失', 'asset', [asset]));
    else {
      var short = b.horizons[asset].short;
      if (['等待触发', '已触发', '部分确认', '已确认', '失败突破', '剧本失效'].indexOf(short.planStatus) < 0 || ['风险预算', '短线事件交易', '趋势交易', '中期逻辑观察', '仅观察'].indexOf(short.tradeType) < 0) issues.push(issue('PLAN_INVALID_' + asset, asset + '剧本状态不合规', asset === 'MARKET' ? 'global' : 'asset', asset === 'MARKET' ? [] : [asset]));
    }
    var required = asset === 'MARKET' ? ['SPY', 'QQQ', 'SOXX'] : [asset];
    required.forEach(function (symbol) {
      var q = (quality.quotes || {})[symbol];
      if (!q || !positive(q.price) || q.status === 'missing') issues.push(issue('PRICE_MISSING_' + symbol, symbol + '关键报价待补全', asset === 'MARKET' ? 'global' : 'asset', [asset]));
      else if (q.status === 'conflict') issues.push(issue('PRICE_CONFLICT_' + symbol, symbol + '关键报价来源冲突', asset === 'MARKET' ? 'global' : 'asset', [asset]));
      else if (!validTime(q.asOf) || q.status !== 'verified') issues.push(issue('PRICE_UNVERIFIED_' + symbol, symbol + '报价时点或来源待核实', asset === 'MARKET' ? 'global' : 'asset', [asset]));
    });
    return unique(issues);
  }
  function evaluate(b, asset, options) {
    var opts = options || {}, now = opts.now == null ? Date.now() : opts.now, gate = b.decisionGate || {};
    var reference = opts.key === 'close' || opts.key !== opts.latestSession || !validTime(gate.validUntil) || now > Date.parse(gate.validUntil);
    var issues = issuesFor(b, asset, opts);
    if (!reference) {
      (asset === 'MARKET' ? ['SPY', 'QQQ', 'SOXX'] : ['SPY', 'QQQ', 'SOXX', asset]).forEach(function (symbol) {
        var q = ((b.quality || {}).quotes || {})[symbol];
        if (q && validTime(q.asOf) && (now - Date.parse(q.asOf) > Number(q.maxAgeMinutes || 150) * 60000 || Date.parse(q.asOf) > now + 60000)) {
          var common = ['SPY', 'QQQ', 'SOXX'].indexOf(symbol) >= 0;
          issues.push(issue('QUOTE_EXPIRED_' + symbol, symbol + '报价已超出本时段有效期', common ? 'global' : 'asset', common ? [] : [asset]));
        }
      });
    }
    // A critical MARKET quote affects all assets; an individual asset never infects its peers.
    if (asset !== 'MARKET') issues = issues.concat(issuesFor(b, 'MARKET', opts).filter(function (x) { return x.level === 'critical' && x.effect === 'execution'; }));
    issues = unique(issues);
    var critical = issues.filter(function (x) { return x.level === 'critical' && x.effect === 'execution'; });
    return {
      mode: reference ? 'reference' : 'live', locked: critical.length > 0, restricted: reference || critical.length > 0,
      issues: issues, localIssues: issues.filter(function (x) { return x.scope !== 'global'; }),
      reason: critical.map(function (x) { return x.message; }).join('；'),
      override: reference || critical.length ? { chase: '关闭', overnight: '关闭', beta: '0' } : {}
    };
  }
  function completion(data, key, expectedDate) {
    var b = data[key], errors = [];
    if (Number(data.meta && data.meta.schemaVersion) !== SCHEMA) errors.push('schema 必须为 v15');
    if (!b || b.available === false) return { complete: false, errors: errors.concat('时段未生成') };
    if (b.sessionDate !== expectedDate) errors.push('交易日不匹配');
    if (!validTime(b.updatedAt)) errors.push('写入时间无效');
    if (!validTime(b.nominalAt) || marketDate(b.nominalAt) !== expectedDate) errors.push('名义时点/交易日无效');
    if (JSON.stringify((b.watchlist || []).map(function (x) { return x.symbol; })) !== JSON.stringify(TARGETS)) errors.push('八标的不完整或顺序错误');
    var quotes = (b.quality || {}).quotes || {};
    REQUIRED_CLOSE.forEach(function (symbol) {
      var q = quotes[symbol];
      if (!q || q.status !== 'verified' || !positive(q.price) || !validTime(q.asOf) || q.marketDate !== expectedDate || marketDate(q.asOf) !== expectedDate || !q.sourceUrl) { errors.push(symbol + '报价缺失/陈旧/未核实'); return; }
      if (key === 'close') {
        if (!q.isFinal || q.session !== 'regular' || !positive(q.volume) || ![q.open, q.high, q.low].every(positive)) errors.push(symbol + '正式收盘 OHLCV 不完整');
        if (!validTime(b.marketCloseAt) || Date.parse(q.asOf) < Date.parse(b.marketCloseAt)) errors.push(symbol + '仍为收盘前快照');
      } else if (!validTime(b.nominalAt) || Date.parse(q.asOf) < Date.parse(b.nominalAt) - 15 * 60000 || Date.parse(q.asOf) > Date.parse(b.updatedAt) + 60000) errors.push(symbol + '不属于本轮有效行情');
    });
    if ((b.quality && b.quality.issues || []).some(function (x) { return x.level === 'critical' && x.effect === 'execution'; })) errors.push('关键数据仍有未解决问题');
    if (key === 'close' && (!b.completion || b.completion.status !== 'final' || !b.decisionGate || !b.decisionGate.closeFinal)) errors.push('收盘尚未正式完成');
    var researchErrors = [];
    if (key === 'close') TARGETS.forEach(function (asset) {
      ['60D', '252D'].forEach(function (window) {
        var row = (b.odds || []).filter(function (x) { return x.asset === asset && x.window === window; })[0];
        if (!row || typeof row.percentile !== 'number' || !Number.isFinite(row.percentile) || row.asOf !== expectedDate || !positive(row.referencePrice) || !positive(row.sampleSize) || !row.historyFile) researchErrors.push(asset + ' ' + window + '尚未按本次正式收盘完成可复算更新');
      });
    });
    return { complete: errors.length === 0, errors: errors, researchComplete: researchErrors.length === 0, researchErrors: researchErrors };
  }
  function percentile(rows, windowSize) {
    var sorted = rows.slice().sort(function (a, b) { return a.date.localeCompare(b.date); });
    if (!sorted.length || new Set(sorted.map(function (x) { return x.date; })).size !== sorted.length || sorted.some(function (x) { return !positive(x.close); })) throw Error('日线缺失、重复或价格无效');
    var sample = sorted.slice(-windowSize), ref = sample[sample.length - 1].close;
    var less = sample.filter(function (x) { return x.close < ref; }).length, equal = sample.filter(function (x) { return x.close === ref; }).length;
    return { percentile: Math.round((less + 0.5 * equal) / sample.length * 1000) / 10, sampleSize: sample.length, referencePrice: ref, asOf: sample[sample.length - 1].date, low: Math.min.apply(null, sample.map(function (x) { return x.close; })), high: Math.max.apply(null, sample.map(function (x) { return x.close; })) };
  }
  function positionPrice(researchSymbol, instrument, researchPrice, instrumentPrice) {
    if (researchSymbol !== 'CRDO') return positive(researchPrice) ? researchPrice : NaN;
    if (instrument === 'CRDO') return positive(researchPrice) ? researchPrice : NaN;
    if (instrument === 'CRDU') return positive(instrumentPrice) ? instrumentPrice : NaN;
    return NaN;
  }
  function finite(value) { return typeof value === 'number' && Number.isFinite(value); }
  function nonempty(value) { return typeof value === 'string' && value.trim().length > 0; }
  function source(value) { return typeof value === 'string' && /^https:\/\//.test(value); }
  // A record is not a trade. Missing evidence is neither a win nor proof of no entry.
  function planErrors(call) {
    var p = call.evaluationPlan, errors = [];
    if (!p || p.version !== 1) return ['缺少前瞻评估方案 v1'];
    var expected = call.asset === 'MARKET' || call.setupType === '风险预算' ? 'market' : ['趋势交易', '短线事件交易'].indexOf(call.setupType) >= 0 ? 'trade' : 'observation';
    if (p.kind !== expected) errors.push('评估类别与交易类型不符');
    if (!nonempty(p.familyId) || !nonempty(p.hypothesisId)) errors.push('缺少同一剧本分组或假设编号');
    if (!validTime(p.recordedAt) || !validTime(call.referenceAt) || Date.parse(p.recordedAt) < Date.parse(call.referenceAt)) errors.push('方案形成时间不得早于参考行情');
    if (!validTime(p.validUntil) || !(Date.parse(p.validUntil) > Date.parse(p.recordedAt))) errors.push('缺少有效的触发截止时间');
    if (!['15m', '30m', '1d'].includes(p.confirmationTimeframe)) errors.push('必须事先指定确认收线周期');
    if (!Array.isArray(p.conditions) || !p.conditions.length || p.conditions.some(function (c) { return !c || !nonempty(c.id) || !nonempty(c.rule); }) || new Set(p.conditions.map(function (c) { return c.id; })).size !== p.conditions.length) errors.push('确认条件必须逐项列明且编号唯一');
    if (!nonempty(p.invalidationRule)) errors.push('缺少精确的失效口径');
    if (p.kind === 'trade') {
      if (!['long', 'short'].includes(p.direction) || !positive(p.stopPrice)) errors.push('缺少方向或初始止损价');
      if (p.entryRule !== 'next_bar_open' || p.exitRule !== 'stop_or_horizon' || !['touch', 'bar_close'].includes(p.stopRule)) errors.push('进出场规则不完整');
      if (![1, 3].includes(p.horizonTradingDays) || !finite(p.roundTripCostBps) || p.roundTripCostBps < 0) errors.push('缺少固定交易日持有期限或双边费用假设');
    }
    return errors;
  }
  function triggerErrors(call) {
    var p = call.evaluationPlan, o = call.outcome || {}, e = o.triggerEvidence || {}, errors = [];
    if (!validTime(o.triggeredAt) || !p || !(Date.parse(o.triggeredAt) > Date.parse(p.recordedAt)) || Date.parse(o.triggeredAt) > Date.parse(p.validUntil)) errors.push('触发必须晚于方案形成且不晚于截止时间');
    if (!validTime(e.barClosedAt) || e.barClosedAt !== o.triggeredAt || e.timeframe !== (p || {}).confirmationTimeframe) errors.push('缺少对应周期的实际收线时间');
    var checks = Array.isArray(e.checks) ? e.checks : [];
    if (!p || !Array.isArray(p.conditions) || p.conditions.some(function (c) {
      if (!c) return true;
      var hits = checks.filter(function (x) { return x && x.conditionId === c.id; }), x = hits[0];
      return hits.length !== 1 || !x || x.result !== 'pass' || !nonempty(x.observed) || !source(x.sourceUrl) || !validTime(x.asOf) || Date.parse(x.asOf) > Date.parse(o.triggeredAt) || Date.parse(x.asOf) <= Date.parse(p.recordedAt);
    })) errors.push('触发条件未逐项提供通过证据、来源和实际时点');
    return errors;
  }
  function resultErrors(call) {
    var p = call.evaluationPlan || {}, o = call.outcome || {}, e = o.execution || {}, errors = [];
    if (p.kind !== 'trade') return ['观察与市场预算不进入交易收益统计'];
    if (!['closed', 'invalidated'].includes(o.status)) errors.push('交易尚未结束');
    if (!positive(e.entryPrice) || !positive(e.exitPrice) || !validTime(e.entryAt) || !validTime(e.exitAt) || !(Date.parse(e.entryAt) > Date.parse(o.triggeredAt)) || !(Date.parse(e.exitAt) > Date.parse(e.entryAt))) errors.push('缺少有效模拟进出场价格与先后顺序');
    if (!validTime(o.evaluatedAt) || Date.parse(o.evaluatedAt) < Date.parse(e.exitAt) || !source(e.sourceUrl) || e.pathVerified !== true) errors.push('结果路径、来源或评估时间待核实');
    if (e.ambiguous !== false) errors.push('同根K线或成交先后仍有歧义');
    if (!['stop', 'horizon'].includes(e.exitReason) || !validTime(e.horizonAt) || !(Date.parse(e.horizonAt) > Date.parse(e.entryAt)) || (e.exitReason === 'horizon' && e.exitAt !== e.horizonAt) || (e.exitReason === 'stop' && Date.parse(e.exitAt) > Date.parse(e.horizonAt))) errors.push('缺少按交易日核验的目标退出时点');
    if (!finite(o.mfe) || !finite(o.mae) || o.mfe < 0 || o.mae > 0) errors.push('缺少进场后区间的MFE/MAE');
    var risk = p.direction === 'short' ? p.stopPrice - e.entryPrice : e.entryPrice - p.stopPrice;
    if (!(risk > 0)) errors.push('开盘跳空后初始止损已失效');
    var value = o['return' + p.horizonTradingDays + 'D'];
    var gross = (p.direction === 'short' ? -1 : 1) * (e.exitPrice / e.entryPrice - 1) * 100;
    if (!finite(value) || !finite(gross) || Math.abs(value - (gross - p.roundTripCostBps / 100)) > 0.011) errors.push('净收益缺失或与价格、费用不一致');
    return errors;
  }
  function auditCall(call) {
    var o = call.outcome || {}, flags = [], hasTrigger = validTime(o.triggeredAt);
    if (o.status === 'invalidated' && !hasTrigger) flags.push('失效但触发待证');
    if (hasTrigger && (!validTime(call.referenceAt) || Date.parse(o.triggeredAt) <= Date.parse(call.referenceAt))) flags.push('触发不晚于参考时点');
    if (o.falseBreakout === true && !hasTrigger) flags.push('失败突破缺少触发记录');
    if (o.status === 'closed' && (!call.evaluationPlan || call.evaluationPlan.kind === 'trade') && !finite(o.return1D) && !finite(o.return3D)) flags.push('已结但收益未评估');
    var protocol = planErrors(call), trigger = hasTrigger ? triggerErrors(call) : ['没有触发记录'], result = resultErrors(call);
    var eligible = !protocol.length && !trigger.length && !result.length;
    var label = o.status === 'invalidated' ? (hasTrigger ? '触发后失效·待核验' : '失效·触发待证') : o.status === 'closed' ? '已结·结果待核验' : o.status === 'triggered' ? '有触发记录·待评估' : o.status === 'expired' ? '已到期·未记触发' : call.supersededBy ? '已替换·原案保留' : '等待触发';
    if (eligible) label = '已核验模拟结果';
    else if (o.status === 'closed' && call.evaluationPlan && call.evaluationPlan.kind !== 'trade') label = '非交易记录·已结束';
    return { callId: call.callId, hasTrigger: hasTrigger, eligible: eligible, label: label, flags: flags, exclusions: protocol.concat(trigger, result), netReturn: eligible ? o['return' + call.evaluationPlan.horizonTradingDays + 'D'] : null };
  }
  function auditLedger(calls) {
    var rows = calls.map(auditCall), n = function (f) { return calls.filter(f).length; };
    var cohorts = {};
    calls.forEach(function (c, i) {
      if (!rows[i].eligible) return;
      var p = c.evaluationPlan, key = [c.regimeCode, c.setupType, p.hypothesisId, p.confirmationTimeframe, p.horizonTradingDays, p.direction, p.roundTripCostBps].join('|');
      if (!cohorts[key]) cohorts[key] = { key: key, records: 0, families: [] };
      var cohort = cohorts[key]; cohort.records += 1;
      if (!cohort.families.includes(p.familyId)) cohort.families.push(p.familyId);
    });
    return { total: calls.length, triggered: rows.filter(function (r) { return r.hasTrigger; }).length,
      invalidated: n(function (c) { return c.outcome.status === 'invalidated'; }),
      invalidatedWithTrigger: n(function (c) { return c.outcome.status === 'invalidated' && validTime(c.outcome.triggeredAt); }),
      invalidatedUnverified: n(function (c) { return c.outcome.status === 'invalidated' && !validTime(c.outcome.triggeredAt); }),
      closedMissingReturns: rows.filter(function (r) { return r.flags.includes('已结但收益未评估'); }).length,
      chronologyFlags: rows.filter(function (r) { return r.flags.includes('触发不晚于参考时点'); }).length,
      falseBreakoutUnverified: rows.filter(function (r) { return r.flags.includes('失败突破缺少触发记录'); }).length,
      open: n(function (c) { return !c.supersededBy && c.outcome.status === 'open'; }),
      pending: n(function (c) { return c.outcome.status === 'triggered'; }),
      expired: n(function (c) { return c.outcome.status === 'expired'; }),
      eligible: rows.filter(function (r) { return r.eligible; }).length, rows: rows, cohorts: Object.values(cohorts) };
  }
  return { SCHEMA: SCHEMA, TARGETS: TARGETS, ACTIONS: ACTIONS, QUOTES: QUOTES, REQUIRED_CLOSE: REQUIRED_CLOSE, positive: positive, validTime: validTime, marketDate: marketDate, issue: issue, evaluate: evaluate, completion: completion, percentile: percentile, positionPrice: positionPrice, planErrors: planErrors, triggerErrors: triggerErrors, resultErrors: resultErrors, auditCall: auditCall, auditLedger: auditLedger };
});
