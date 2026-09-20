(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.SectorModel=factory()})(typeof self!=='undefined'?self:this,function(){
  'use strict';
  function rank(rows){
    if(!Array.isArray(rows)||!rows.length||new Set(rows.map(x=>x.name)).size!==rows.length||rows.some(x=>!x.name||typeof x.changePct!=='number'||!Number.isFinite(x.changePct)))throw Error('行业样本缺失、重复或涨跌幅无效');
    return {gainers:rows.filter(x=>x.changePct>0).sort((a,b)=>b.changePct-a.changePct||a.name.localeCompare(b.name)).slice(0,5),losers:rows.filter(x=>x.changePct<0).sort((a,b)=>a.changePct-b.changePct||a.name.localeCompare(b.name)).slice(0,5)};
  }
  function errors(p){
    if(!p)return ['缺少行业榜'];
    const e=[];
    if(!['snapshot','final','partial','unavailable'].includes(p.status))e.push('行业状态无效');
    if(!Number.isFinite(Date.parse(p.fetchedAt)))e.push('缺少真实抓取时间');
    if(p.status==='unavailable')return p.note?e:e.concat('来源失败须说明原因');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(p.marketDate||'')||!p.dateBasis)e.push('缺少行业行情日期与核对依据');
    if(!/^https:\/\//.test(p.sourceUrl||'')||!p.universe||p.universeCount!==p.rows?.length)e.push('行业来源/范围不完整');
    if(p.status==='final'&&!Number.isFinite(Date.parse(p.asOf)))e.push('正式收盘须有来源时点');
    try{const r=rank(p.rows);for(const side of ['gainers','losers']){
      if(JSON.stringify((p[side]||[]).map(x=>[x.name,x.changePct]))!==JSON.stringify(r[side].map(x=>[x.name,x.changePct])))e.push(side+'与完整样本排名不一致');
      for(const x of p[side]||[]){if(!x.label||!x.reason||!['reported','inference','unknown'].includes(x.driverStatus))e.push(x.name+'解释/归因状态不完整');if(x.driverStatus!=='unknown'&&(!x.sources?.length||x.sources.some(s=>!/^https:\/\//.test(s.url||'')||!s.title)))e.push(x.name+'归因缺少来源');}
    }}catch(x){e.push(x.message)}
    return e;
  }
  return {rank,errors};
});
