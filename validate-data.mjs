import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {SYMBOLS,SECTORS,validQuote} from './dashboard-model.mjs';
import {pulseErrors} from './sector-pulse.mjs';
const date=s=>typeof s==='string'&&Number.isFinite(Date.parse(s));
const num=n=>typeof n==='number'&&Number.isFinite(n);
const https=s=>typeof s==='string'&&s.startsWith('https://');
export function validate(d,old=null){
  const errors=[];const need=(ok,msg)=>{if(!ok)errors.push(msg)};
  const m=d.meta||{};need(m.schemaVersion===18,'schemaVersion must be 18');
  need(m.timezone==='Asia/Shanghai','timezone');need(date(m.asOf)&&date(m.updatedAt),'meta timestamps');
  need(Date.parse(m.asOf)<=Date.parse(m.updatedAt),'asOf cannot exceed update time');
  need(['premarket','intraday','late','close'].includes(m.session),'session');
  need(['close','intraday'].includes(m.priceBasis),'priceBasis');need(typeof m.automationEnabled==='boolean','automationEnabled');
  need(/^\d{4}-\d{2}-\d{2}$/.test(m.marketDate||''),'marketDate');
  const required=m.rulesVersion==='18.2'?SYMBOLS:SYMBOLS.filter(s=>!['RSP','SPMO','VIX3M'].includes(s));
  need(JSON.stringify(Object.keys(d.assets||{}).sort())===JSON.stringify([...required].sort()),'fixed symbol roster');
  for(const s of required){const q=d.assets?.[s];if(!q){errors.push(`${s} missing`);continue}
    need(q.symbol===s,`${s} identity`);need(['verified','unavailable'].includes(q.status),`${s} status`);
    need(['up','down','mixed','unknown'].includes(q.trend30m),`${s} trend`);
    if(q.status==='verified'){
      need(validQuote(q,m),`${s} stale, future, or invalid price`);need(date(q.baselineAt)&&Date.parse(q.baselineAt)<Date.parse(q.asOf),`${s} baseline time`);
      need(num(q.baselinePrice)&&q.baselinePrice>0,`${s} baseline price`);
      need(Math.abs((q.price/q.baselinePrice-1)*100-q.changePct)<.02,`${s} return mismatch`);
      need(https(q.sourceUrl)&&date(q.fetchedAt),`${s} provenance`);
      need(Array.isArray(q.spark)&&q.spark.every(x=>num(x)&&x>0),`${s} spark`);
      if(q.trend30m!=='unknown')need(num(q.ema20)&&num(q.emaSlopePct)&&q.barCount>=25,`${s} trend evidence`);
    }else need(q.price===null&&q.changePct===null&&q.trend30m==='unknown',`${s} unavailable must not carry numeric claims`);
  }
  const b=d.breadth||{};need(['verified','snapshot','unavailable'].includes(b.status),'breadth status');
  if(b.status!=='unavailable'){
    need(b.marketDate===m.marketDate,'breadth date');need(Number.isInteger(b.advancing)&&Number.isInteger(b.declining)&&b.advancing>=0&&b.declining>=0&&b.advancing+b.declining>0,'breadth counts');
    need(num(b.upPct)&&Math.abs(b.upPct-100*b.advancing/(b.advancing+b.declining))<.02,'breadth ratio');
    need(https(b.sourceUrl)&&date(b.fetchedAt),'breadth source');
    need(b.status!=='verified'||date(b.asOf),'verified breadth needs time');
  }
  for(const [id,n] of Object.entries(d.news||{})){
    need(SECTORS.some(s=>s.id===id),'unknown news sector');
    need(typeof n.text==='string'&&n.text.length<=350,'news text');need(date(n.publishedAt)&&date(n.expiresAt),'news dates');
    need(Date.parse(n.publishedAt)<=Date.parse(m.updatedAt)&&Date.parse(n.expiresAt)>Date.parse(n.publishedAt),'news time order');
    need(['reported','inference'].includes(n.kind),'news kind');
    need(Array.isArray(n.sources)&&n.sources.length>=1&&n.sources.length<=2&&n.sources.every(s=>https(s.url)&&s.name),'news sources');
  }
  need(!d.previous?.previous,'no recursive history');
  if(d.sectorPulse)errors.push(...pulseErrors(d.sectorPulse,m));
  if(d.previous)need(Date.parse(d.previous.meta?.asOf)<Date.parse(m.asOf),'previous must be earlier');
  if(old?.meta?.schemaVersion===18)need(Date.parse(m.asOf)>=Date.parse(old.meta.asOf),'must not rewind latest snapshot');
  return errors;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const d=JSON.parse(fs.readFileSync(process.argv[2]||'data.json','utf8'));
  const old=process.argv[3]?JSON.parse(fs.readFileSync(process.argv[3],'utf8')):null;
  const errors=validate(d,old);console.log(JSON.stringify({valid:errors.length===0,errors}));process.exitCode=errors.length?1:0;
}
