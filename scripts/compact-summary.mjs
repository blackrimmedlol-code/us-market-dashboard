import fs from 'node:fs';
import {summarize,newsFor,SECTORS} from '../dashboard-model.mjs';
const d=JSON.parse(fs.readFileSync(new URL('../data.json',import.meta.url),'utf8'));
console.log(JSON.stringify({meta:d.meta,...summarize(d),previous:d.previous?summarize(d.previous):null,
  missing:Object.values(d.assets).filter(q=>q.status!=='verified').map(q=>({symbol:q.symbol,note:q.note})),
  news:Object.fromEntries(SECTORS.map(s=>[s.id,newsFor(d,s.id)]))}));
