import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {comparisonMode,sectorInsights,SECTORS} from './dashboard-model.mjs';
import {researchPlan,reusableIndustry} from './scripts/research-plan.mjs';
const data=JSON.parse(fs.readFileSync(new URL('./data.json',import.meta.url)));
test('formal intraday-to-close transition preserves the genuine regime and sector comparison',()=>{
  const d=structuredClone(data);d.meta.priceBasis='close';
  d.previous=structuredClone({meta:{...d.meta,priceBasis:'intraday'},assets:d.assets,breadth:d.breadth});
  d.previous.assets.DRAM.trend30m='mixed';
  assert.equal(comparisonMode(d.meta,d.previous.meta),'comparable');
  assert.match(sectorInsights(SECTORS[0],d).delta,/改善/);
  assert.doesNotMatch(sectorInsights(SECTORS[0],d).delta,/口径切换|规则升级/);
});
test('real method switches and rules changes suppress comparisons for the right reason',()=>{
  assert.equal(comparisonMode({rulesVersion:'18.2',priceBasis:'close'},{rulesVersion:'18.2',priceBasis:'premarket'}),'basis');
  assert.equal(comparisonMode({rulesVersion:'18.2',priceBasis:'close'},{rulesVersion:'18.1',priceBasis:'close'}),'rules');
});
test('event reuse retains timestamps; shared source events form one research group',()=>{
  const d=structuredClone(data),p=d.sectorPulse,n=p.news['Semiconductor Equipment & Materials'];
  n.checkedAt=d.meta.updatedAt;
  const plan=researchPlan(d);
  const shared=plan.events.find(e=>e.targets.includes('sector:memory')&&e.targets.includes('industry:Semiconductor Equipment & Materials'));
  assert.ok(shared);assert.ok(plan.cachedIndustries.includes('Semiconductor Equipment & Materials'));
  assert.equal(n.checkedAt,d.meta.updatedAt);
});
test('expired, old and uncertain industry events are never silently treated as fresh',()=>{
  const p={news:{A:{text:'event',kind:'reported',checkedAt:'2026-09-30T14:00:00Z',publishedAt:'2026-09-30',expiresAt:'2026-09-30T15:00:00Z',sources:[{url:'https://example.com'}]}}};
  assert.equal(reusableIndustry(p,'A','2026-09-30T15:01:00Z'),false);
  p.news.A.kind='unknown';assert.equal(reusableIndustry(p,'A','2026-09-30T15:01:00Z'),false);
});
