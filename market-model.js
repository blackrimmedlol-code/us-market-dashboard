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
  return { SCHEMA: SCHEMA, TARGETS: TARGETS, ACTIONS: ACTIONS, QUOTES: QUOTES, REQUIRED_CLOSE: REQUIRED_CLOSE, positive: positive, validTime: validTime, marketDate: marketDate, issue: issue, evaluate: evaluate, completion: completion, percentile: percentile, positionPrice: positionPrice };
});
