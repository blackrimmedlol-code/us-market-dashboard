import fs from 'node:fs';
import {summarize,newsFor,SECTORS,sectorInsights} from '../dashboard-model.mjs';
const d=JSON.parse(fs.readFileSync(new URL('../data.json',import.meta.url),'utf8'));
console.log(JSON.stringify({meta:d.meta,...summarize(d),previous:d.previous?summarize(d.previous):null,marketComparisonComparable:d.previous?.meta.rulesVersion===d.meta.rulesVersion,
  sectorAnalysis:Object.fromEntries(SECTORS.map(s=>[s.id,sectorInsights(s,d)])),
  sectorPulse:d.sectorPulse?Object.fromEntries(Object.entries(d.sectorPulse).filter(([key])=>key!=='rows')):null,
  missing:Object.values(d.assets).filter(q=>q.status!=='verified').map(q=>({symbol:q.symbol,note:q.note})),
  news:Object.fromEntries(SECTORS.map(s=>[s.id,newsFor(d,s.id)]))}));
