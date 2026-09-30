import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {validate} from './validate-data.mjs';
import {SYMBOLS,validQuote} from './dashboard-model.mjs';
import {reusableIndustry} from './scripts/research-plan.mjs';
export function checkSession(d,session,marketDate){
  const errors=validate(d),m=d.meta;
  if(errors.length)return {valid:false,errors,complete:false,missing:[]};
  const missing=SYMBOLS.filter(s=>!validQuote(d.assets[s],m));
  if(m.session!==session)missing.push('target session');
  if(m.marketDate!==marketDate)missing.push('target market date');
  if(session==='premarket'&&m.priceBasis!=='premarket')missing.push('live premarket prices');
  if(session==='close'&&m.priceBasis!=='close')missing.push('formal close');
  if(d.breadth.status==='unavailable')missing.push('breadth');
  if(m.newsReviewStatus==='partial')missing.push('battlefield news review');
  if(!d.sectorPulse||d.sectorPulse.status==='unavailable')missing.push('industry leaderboard');
  else{
    const p=d.sectorPulse;
    for(const r of [...p.gainers,...p.losers]){
      if(p.coreTickers?.[r.name]?.status!=='verified'||!p.coreTickers[r.name].symbols?.length)missing.push('industry core tickers: '+r.name);
      const n=p.news?.[r.name],fresh=Number.isFinite(Date.parse(n?.checkedAt))&&Date.parse(n.checkedAt)>=Date.parse(p.fetchedAt);
      const cached=p.reviewStatus==='cached'||p.reviewStatus==='complete'||p.reviewStatus==='partial';
      if(!n||!(fresh||cached&&n.reusedAt&&Date.parse(n.reusedAt)>=Date.parse(p.fetchedAt)&&reusableIndustry(p,r.name,m.updatedAt)))missing.push('industry news: '+r.name);
      else if(n.kind!=='unknown'&&Date.parse(n.expiresAt)<Date.parse(m.updatedAt))missing.push('industry news: '+r.name);
    }
  }
  return {valid:true,complete:!missing.length,missing,asOf:m.asOf,session:m.session};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const [file='data.json',session,marketDate]=process.argv.slice(2);
  const result=checkSession(JSON.parse(fs.readFileSync(file,'utf8')),session,marketDate);
  console.log(JSON.stringify(result));process.exitCode=!result.valid?1:result.complete?0:2;
}
