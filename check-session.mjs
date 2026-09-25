import fs from 'node:fs';
import {validate} from './validate-data.mjs';
import {SYMBOLS,validQuote} from './dashboard-model.mjs';
const [file='data.json',session,marketDate]=process.argv.slice(2);
const d=JSON.parse(fs.readFileSync(file,'utf8')),errors=validate(d),m=d.meta;
if(errors.length){console.log(JSON.stringify({valid:false,errors}));process.exit(1)}
const missing=SYMBOLS.filter(s=>!validQuote(d.assets[s],m));
if(m.session!==session)missing.push('target session');
if(session==='premarket'?m.marketDate>=marketDate:m.marketDate!==marketDate)missing.push('target market date');
if(session==='close'&&m.priceBasis!=='close')missing.push('formal close');
if(d.breadth.status==='unavailable')missing.push('breadth');
if(!d.sectorPulse||d.sectorPulse.status==='unavailable')missing.push('industry leaderboard');
else {
  const p=d.sectorPulse;
  if(!p.researchAt||!Number.isFinite(Date.parse(p.researchAt))||Date.parse(p.researchAt)<Date.parse(p.fetchedAt))missing.push('industry news review');
  for(const r of [...p.gainers,...p.losers]){
    const n=p.news?.[r.name];
    if(!n||Date.parse(n.checkedAt)<Date.parse(p.fetchedAt)||n.kind!=='unknown'&&Date.parse(n.expiresAt)<Date.parse(p.researchAt))missing.push('industry news: '+r.name);
  }
}
console.log(JSON.stringify({complete:!missing.length,missing,asOf:m.asOf,session:m.session}));
process.exitCode=missing.length?2:0;
