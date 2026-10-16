import {newsFor,SECTORS} from '../dashboard-model.mjs';
const time=x=>Date.parse(x);
const url=s=>{try{const u=new URL(s);u.hash='';for(const k of [...u.searchParams.keys()])if(k.startsWith('utm_'))u.searchParams.delete(k);return u.toString();}catch{return s;}};
export function reusableIndustry(p,name,now){
  const n=p?.news?.[name],checked=time(n?.checkedAt),current=time(now);
  if(!n?.text||!Number.isFinite(checked)||checked>current)return false;
  if(n.kind==='unknown')return current-checked<3600000;
  return ['reported','inference'].includes(n.kind)&&n.sources?.length>0&&time(n.publishedAt)<=current&&time(n.expiresAt)>current&&current-checked<3*3600000;
}
export function researchPlan(d,now=d.meta.updatedAt){
  const p=d.sectorPulse,names=p?.status==='snapshot'?[...p.gainers,...p.losers].map(r=>r.name):[];
  const cached=names.filter(n=>reusableIndustry(p,n,now));
  const events=new Map();
  const add=(target,n)=>{if(!n)return;for(const s of n.sources||[]){const key=url(s.url);if(!events.has(key))events.set(key,{url:key,source:s.name,targets:[],publishedAt:n.publishedAt});const e=events.get(key);if(!e.targets.includes(target))e.targets.push(target);}};
  for(const s of SECTORS)add('sector:'+s.id,newsFor(d,s.id));
  for(const name of names)add('industry:'+name,p.news?.[name]);
  return {since:d.meta.newsCheckedAt||d.previous?.meta?.newsCheckedAt||d.previous?.meta?.updatedAt||null,
    sectors:SECTORS.map(s=>({id:s.id,name:s.name,symbols:[s.anchor,...s.members,...(s.coins||[])].filter(Boolean)})),
    neededIndustries:names.filter(n=>!cached.includes(n)),cachedIndustries:cached,
    events:[...events.values()],instruction:'批量查上次核实后增量；相同来源事件只核实一次，再分别说明对各目标的关系。有效缓存保留原 checkedAt；未检索不得写已核实。'};
}
