import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import sectors from './sector-model.js';
const pulse=JSON.parse(readFileSync(new URL('./data.json',import.meta.url))).sectorPulse;
test('full universe reproduces ten ranked industries and sourced driver labels',()=>{
 assert.deepEqual(sectors.errors(pulse),[]);
 const bad=structuredClone(pulse);bad.gainers[0].changePct=100;
 assert.ok(sectors.errors(bad).some(x=>x.includes('排名')));
 const unsourced=structuredClone(pulse);unsourced.gainers[0].sources=[];
 assert.ok(sectors.errors(unsourced).some(x=>x.includes('来源')));
});
test('one-sided markets never fabricate five decliners; equal moves have stable ordering',()=>{
 assert.equal(sectors.rank([{name:'A',changePct:1},{name:'B',changePct:0}]).losers.length,0);
 assert.deepEqual(sectors.rank([{name:'B',changePct:-1},{name:'A',changePct:-1}]).losers.map(x=>x.name),['A','B']);
 assert.throws(()=>sectors.rank([{name:'A',changePct:1},{name:'A',changePct:2}]));
 assert.throws(()=>sectors.rank([{name:'A',changePct:NaN}]));
});
