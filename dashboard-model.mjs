export const SECTORS = [
  {id:'memory',name:'存储',en:'MEMORY',number:'01',members:['MU','SKHY','SNDK','WDC'],anchor:'DRAM',description:'DRAM 看整体 · 四只代表股看内部共振'},
  {id:'cloud',name:'新云',en:'NEOCLOUD',number:'02',members:['IREN','NBIS','CRWV'],description:'AI 云与算力 · 固定三只代表股'},
  {id:'space',name:'太空',en:'SPACE',number:'03',members:['SPCX','RKLB','ASTS'],description:'发射、航天系统与卫星通信'},
  {id:'crypto',name:'加密货币',en:'CRYPTO',number:'04',members:['COIN','MSTR'],coins:['BTC','ETH'],aux:['HOOD'],description:'币与股分开看 · HOOD 仅作辅助'},
];
export const SYMBOLS = ['SPY','QQQ','VIX','DRAM',...new Set(SECTORS.flatMap(s=>[...s.members,...(s.coins||[]),...(s.aux||[])]))];
export const LABELS = {RISK_ON:'Risk-on',MIXED:'分化',RISK_OFF:'Risk-off',UNKNOWN:'待确认',up:'走强',down:'走弱',mixed:'分化',unknown:'待确认'};
const finite = n => typeof n==='number' && Number.isFinite(n);
const mean = list => list.length?list.reduce((a,b)=>a+b,0)/list.length:null;
export function validQuote(q,meta) {
  return q?.status==='verified' && finite(q.price) && q.price>0 && finite(q.changePct) &&
    q.marketDate===meta.marketDate && Number.isFinite(Date.parse(q.asOf)) &&
    Date.parse(q.asOf)<=Date.parse(meta.asOf) && Date.parse(meta.asOf)-Date.parse(q.asOf)<=30*60000;
}
export function aligned(q,b) {return Boolean(q?.baselineAt && b?.baselineAt && q?.asOf && b?.asOf) && q.baselineAt===b.baselineAt && q.asOf===b.asOf;}
export function direction(list) {
  if (!list.length || list.some(q=>!['up','down','mixed'].includes(q.trend30m))) return 'unknown';
  const ups=list.filter(q=>q.trend30m==='up').length;
  const downs=list.filter(q=>q.trend30m==='down').length;
  return ups/list.length>=2/3?'up':downs/list.length>=2/3?'down':'mixed';
}
export function marketState(data) {
  const {assets:a,meta:m,breadth:b}=data;
  const qs=['QQQ','SPY'].map(s=>a[s]);
  if (qs.some(q=>!validQuote(q,m))) return {state:'UNKNOWN',price:'unknown',breadth:'unknown',volatility:'unknown',confidence:'低'};
  // Both benchmarks must agree with their completed-bar trend and approximate VWAP.
  const up=qs.every(q=>q.trend30m==='up'&&finite(q.vwapApprox)&&q.price>=q.vwapApprox);
  const down=qs.every(q=>q.trend30m==='down'&&finite(q.vwapApprox)&&q.price<=q.vwapApprox);
  const usable=qs.every(q=>['up','down','mixed'].includes(q.trend30m)&&finite(q.vwapApprox));
  const price=!usable?'unknown':up?'up':down?'down':'mixed';
  const breadthOK=['verified','snapshot'].includes(b?.status)&&b?.marketDate===m.marketDate&&finite(b?.upPct);
  const breadth=breadthOK?(b.upPct>=55?'up':b.upPct<=45?'down':'mixed'):'unknown';
  const volatility=validQuote(a.VIX,m)?(a.VIX.changePct>0?'rising':'easing'):'unknown';
  let state='MIXED';
  if(price==='unknown') state='UNKNOWN';
  else if(price==='up'&&breadth==='up'&&volatility==='easing') state='RISK_ON';
  else if(price==='down'&&breadth==='down'&&volatility==='rising') state='RISK_OFF';
  if(breadth==='unknown'||volatility==='unknown') state='UNKNOWN';
  return {state,price,breadth,volatility,confidence:state==='UNKNOWN'?'低':b.status==='snapshot'?'中':'高'};
}
export function sectorState(def,data) {
  const {assets:a,meta:m}=data;
  const members=def.members.map(s=>a[s]);
  const valid=members.filter(q=>validQuote(q,m));
  const complete=valid.length===members.length;
  const anchor=def.anchor?a[def.anchor]:null;
  const anchorOK=anchor&&validQuote(anchor,m);
  const average=complete?mean(valid.map(q=>q.changePct)):null;
  const change=def.anchor?(anchorOK?anchor.changePct:null):average;
  const peers=complete?direction(valid):'unknown';
  let trend=def.anchor?(anchorOK&&peers!=='unknown'?anchor.trend30m:'unknown'):peers;
  if(def.anchor && peers!=='unknown' && trend!=='unknown' && trend!==peers) trend='mixed';
  const relativeOK=validQuote(a.QQQ,m)&&(def.anchor?anchorOK&&aligned(anchor,a.QQQ):complete&&valid.every(q=>aligned(q,a.QQQ)));
  const relative=relativeOK&&finite(change)?change-a.QQQ.changePct:null;
  const coins=(def.coins||[]).map(s=>a[s]);
  const coinTrend=coins.length&&coins.every(q=>validQuote(q,m))?direction(coins):'unknown';
  return {id:def.id,trend,peerTrend:peers,change,relative,relativeLabel:relative===null?'待确认':relative>0.2?'强于大盘':relative<-.2?'弱于大盘':'接近大盘',
    count:valid.length,total:members.length,advancing:valid.filter(q=>q.changePct>0).length,
    complete,coinTrend,split:coins.length&&coinTrend!=='unknown'&&trend!=='unknown'&&coinTrend!==trend};
}
export function summarize(data) {
  return {market:marketState(data),sectors:SECTORS.map(s=>sectorState(s,data))};
}
const rank={RISK_OFF:0,MIXED:1,RISK_ON:2,down:0,mixed:1,up:2};
export function compare(current,previous) {
  if(previous===null||previous===undefined) return '首次记录';
  if(!(current in rank)||!(previous in rank)) return '待确认';
  return rank[current]>rank[previous]?'改善':rank[current]<rank[previous]?'恶化':'持平';
}
export function newsFor(data,id) {
  const news=data.news?.[id];
  if(!news?.text||!news?.publishedAt||!news?.expiresAt||!Array.isArray(news.sources)||!news.sources.length) return null;
  const cutoff=Date.parse(data.meta.updatedAt||data.meta.asOf);
  const published=Date.parse(news.publishedAt),expires=Date.parse(news.expiresAt);
  if(![cutoff,published,expires].every(Number.isFinite)||published>cutoff||expires<cutoff||expires<published) return null;
  return {...news,afterSnapshot:published>Date.parse(data.meta.asOf)};
}
