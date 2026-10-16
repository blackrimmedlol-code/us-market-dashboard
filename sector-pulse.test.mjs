import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {rankIndustries,pulseErrors,pulseNews,coreTickers} from './sector-pulse.mjs';
test('core tickers require verified provenance and at most four unique symbols',()=>{
  const c={status:'verified',selection:'optionable-marketcap',checkedAt:'2026-09-25T18:00:00Z',sourceUrl:'https://finviz.com/screener.ashx?f=ind_solar',symbols:['FSLR','ENPH']};
  const p={coreTickers:{Solar:c}};
  assert.deepEqual(coreTickers(p,'Solar'),['FSLR','ENPH']);
  assert.deepEqual(coreTickers(p,'Airlines'),[]);
  c.symbols=['FSLR','FSLR'];assert.deepEqual(coreTickers(p,'Solar'),[]);
  c.symbols=['A','B','C','D','E'];assert.deepEqual(coreTickers(p,'Solar'),[]);
  c.symbols=['FSLR'];c.status='unavailable';assert.deepEqual(coreTickers(p,'Solar'),[]);
});
const p=JSON.parse(fs.readFileSync(new URL('./history/v18/2026-09-24-close-industries.json',import.meta.url)));
const meta={marketDate:'2026-09-24',asOf:p.targetAsOf};
test('recorded full universe reproduces top three independently of incoming order',()=>{
  const reversed=[...p.rows].reverse();
  assert.deepEqual(rankIndustries(reversed),{gainers:p.gainers,losers:p.losers});
  assert.deepEqual(pulseErrors(p,meta),[]);
});
test('few positive industries never fill gainers with zero or negative returns',()=>{
  const result=rankIndustries([{name:'A',changePct:0},{name:'B',changePct:-4},{name:'C',changePct:1}]);
  assert.deepEqual(result.gainers,[{name:'C',changePct:1}]);
  assert.deepEqual(result.losers,[{name:'B',changePct:-4}]);
});
test('stale day or window cannot appear as current rankings',()=>{
  assert.ok(pulseErrors(p,{...meta,marketDate:'2026-09-25'}).length);
  assert.ok(pulseErrors(p,{...meta,asOf:'2026-09-24T18:00:00Z'}).length);
});
test('duplicate universe or altered ranking is rejected',()=>{
  const bad=structuredClone(p);bad.rows[1]=bad.rows[0];assert.ok(pulseErrors(bad,meta).length);
  const wrong=structuredClone(p);wrong.gainers.reverse();assert.ok(pulseErrors(wrong,meta).length);
});
test('news expiry and post-snapshot reporting remain distinct from price causes',()=>{
  const copy=structuredClone(p);const n=copy.news.Solar;
  n.publishedAt='2026-09-24T21:00:00Z';assert.equal(pulseNews(copy,'Solar').afterSnapshot,true);
  n.expiresAt='2026-09-24T23:00:00Z';assert.equal(pulseNews(copy,'Solar'),null);
  assert.equal(pulseNews(copy,'Paper & Paper Products'),null);
});
