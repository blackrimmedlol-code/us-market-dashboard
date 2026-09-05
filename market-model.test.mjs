import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import model from './market-model.js';

const data = JSON.parse(readFileSync(new URL('./data.json', import.meta.url), 'utf8'));
const opts = { schemaVersion: 15, key: 'intraday', latestSession: 'intraday', now: Date.parse('2026-09-04T15:10:00Z') };
function live() {
  const b = structuredClone(data.close);
  b.decisionGate.validUntil = '2026-09-04T18:05:00Z';
  b.quality.issues = [];
  for (const q of Object.values(b.quality.quotes)) { q.asOf = '2026-09-04T15:05:00Z'; q.isFinal = false; }
  return b;
}
test('BTC volume missing does not lock unrelated equities or invent confirmation', () => {
  const b = live(); b.quality.issues.push(model.issue('BTC_VOLUME', 'BTC量能缺失', 'metric', ['MSTR', 'IREN'], 'volume', 'warning'));
  for (const s of model.ACTIONS) assert.equal(model.evaluate(b, s, opts).locked, false, s);
  assert.equal(model.evaluate(b, 'LITE', opts).issues.length, 0);
  assert.equal(model.evaluate(b, 'MSTR', opts).issues.length, 1);
});
test('individual price conflicts only restrict that asset', () => {
  const b = live(); b.quality.quotes.BE.status = 'conflict';
  assert.equal(model.evaluate(b, 'BE', opts).locked, true);
  for (const s of ['MARKET', 'LITE', 'CIEN', 'CRDO', 'MSTR']) assert.equal(model.evaluate(b, s, opts).locked, false);
});
test('market quote failure and stale market quote restrict execution throughout', () => {
  const b = live(); b.quality.quotes.SPY.price = null;
  for (const s of model.ACTIONS) assert.equal(model.evaluate(b, s, opts).locked, true);
  const stale = live(); stale.quality.quotes.SPY.asOf = '2026-09-04T11:00:00Z';
  assert.equal(model.evaluate(stale, 'CIEN', opts).locked, true);
});
test('reference mode remains useful without presenting executable permission', () => {
  const g = model.evaluate(data.close, 'LITE', { ...opts, key: 'close', latestSession: 'close', now: Date.parse('2026-09-06T12:00:00Z') });
  assert.equal(g.mode, 'reference'); assert.equal(g.locked, false); assert.equal(g.restricted, true); assert.equal(g.override.beta, '0');
  const b = live(); b.decisionGate.validUntil = '2026-09-04T14:00:00Z';
  assert.equal(model.evaluate(b, 'LITE', opts).mode, 'reference');
});
test('close completeness rejects 15:52 data even with a fresh write timestamp', () => {
  assert.equal(model.completion(data, 'close', '2026-09-04').complete, true);
  const bad = structuredClone(data); bad.close.quality.quotes.CIEN.asOf = '2026-09-04T19:52:00Z';
  bad.close.updatedAt = '2026-09-05T03:00:00Z';
  assert.equal(model.completion(bad, 'close', '2026-09-04').complete, false);
  bad.close.quality.quotes.CIEN = structuredClone(data.close.quality.quotes.CIEN); bad.close.quality.quotes.CRDO.volume = null;
  assert.equal(model.completion(bad, 'close', '2026-09-04').complete, false);
});
test('missing new ticker and wrong trading date cannot pass idempotency', () => {
  const bad = structuredClone(data); bad.close.watchlist = bad.close.watchlist.filter(x => x.symbol !== 'CRDO');
  assert.equal(model.completion(bad, 'close', '2026-09-04').complete, false);
  assert.equal(model.completion(data, 'close', '2026-09-08').complete, false);
});
test('percentile uses ties correctly and rejects duplicate dates', () => {
  assert.equal(model.percentile([{ date: '2026-09-01', close: 2 }, { date: '2026-09-02', close: 2 }], 60).percentile, 50);
  assert.throws(() => model.percentile([{ date: '2026-09-01', close: 2 }, { date: '2026-09-01', close: 2 }], 60));
});
test('CRDU never inherits CRDO price, and unfinished daily research cannot be skipped', () => {
  assert.equal(Number.isNaN(model.positionPrice('CRDO', 'CRDU', 170.57, undefined)), true);
  assert.equal(Number.isNaN(model.positionPrice('CRDO', '', 170.57, 7)), true);
  assert.equal(model.positionPrice('CRDO', 'CRDU', 170.57, 7), 7);
  assert.equal(model.positionPrice('CRDO', 'CRDO', 170.57, 7), 170.57);
  const stale = structuredClone(data); stale.close.odds.find(x => x.asset === 'CIEN').asOf = '2026-09-03';
  const result = model.completion(stale, 'close', '2026-09-04');
  assert.equal(result.complete, true); assert.equal(result.researchComplete, false);
});
test('writer rejects retrospective trigger edits and unbenchmarked volume confirmation', () => {
  const dir = mkdtempSync(join(tmpdir(), 'market-v15-test-'));
  try {
    const previous = join(dir, 'previous.json'), candidate = join(dir, 'candidate.json'); writeFileSync(previous, JSON.stringify(data));
    const altered = structuredClone(data); altered.decisionLedger[0].trigger = '事后改成命中'; altered.decisionLedger[0].originalPlan.trigger = '事后改成命中';
    writeFileSync(candidate, JSON.stringify(altered));
    let result = spawnSync(process.execPath, [new URL('./validate-data.mjs', import.meta.url).pathname, candidate, previous], { encoding: 'utf8' });
    assert.equal(result.status, 1); assert.match(result.stderr, /与写前原始判断不同|原始快照不可改写/);
    const volume = structuredClone(data); volume.close.horizons.CIEN.short.confirmations.volume = { state: 'confirmed', note: '拿到成交量' };
    writeFileSync(candidate, JSON.stringify(volume));
    result = spawnSync(process.execPath, [new URL('./validate-data.mjs', import.meta.url).pathname, candidate], { encoding: 'utf8' });
    assert.equal(result.status, 1); assert.match(result.stderr, /比较基准/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('all session renderers run, eight cards retain five timeframes, ledger stays open', async () => {
  const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
  assert.match(html, /<details class="ledger-shell"[^>]*open/);
  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) elements.set(id, { innerHTML: '', textContent: '', hidden: false, dataset: {}, style: {}, classList: { add() {}, remove() {}, toggle() {} }, setAttribute() {}, addEventListener() {}, querySelectorAll() { return []; }, scrollIntoView() {} });
    return elements.get(id);
  }
  const document = { documentElement: { dataset: { theme: 'dark' } }, getElementById: element, querySelector: element, querySelectorAll: () => [], addEventListener() {} };
  const context = vm.createContext({ document, window: {}, MarketModel: model, Intl, Date, Set, localStorage: { getItem: () => null, setItem() {} }, fetch: async () => ({ ok: true, json: async () => structuredClone(data) }), setInterval() {}, console });
  const scripts = [...html.matchAll(/<script(?: [^>]*)?>([\s\S]*?)<\/script>/g)].map(x => x[1]).filter(x => x.includes('function render('));
  const script = scripts[0].replace('  })();', 'window.testRender=render; window.testQuoteFor=quoteFor;\n  })();');
  vm.runInContext(script, context); await new Promise(resolve => setImmediate(resolve));
  assert.doesNotMatch(element('updated').textContent, /失败/);
  for (const session of ['premarket', 'intraday', 'late', 'close']) {
    context.window.testRender(session);
    assert.equal((element('action-board').innerHTML.match(/<article class="action-row/g) || []).length, 9);
    for (const symbol of model.TARGETS) assert.equal((element('watch-' + symbol.toLowerCase()).innerHTML.match(/data-note=/g) || []).length, 5, symbol);
    assert.equal((element('quick-dock').innerHTML.match(/data-quick=/g) || []).length, 8);
    assert.doesNotMatch(element('action-board').innerHTML, /数据锁权/);
  }
  assert.equal(Number.isNaN(context.window.testQuoteFor({ symbol: 'CIEN', price: null }, data.premarket).price), true);
});
