export const SECTORS = [
  {id:'memory',name:'存储',en:'MEMORY',number:'01',members:['MU','SKHY','SNDK','WDC'],anchor:'DRAM',description:'DRAM 看整体 · 四只代表股看内部共振'},
  {id:'cloud',name:'新云',en:'NEOCLOUD',number:'02',members:['IREN','NBIS','CRWV'],description:'AI 云与算力 · 固定三只代表股'},
  {id:'space',name:'太空',en:'SPACE',number:'03',members:['SPCX','RKLB','ASTS'],description:'发射、航天系统与卫星通信'},
  {id:'crypto',name:'加密货币',en:'CRYPTO',number:'04',members:['COIN','MSTR'],coins:['BTC','ETH'],aux:['HOOD'],description:'币与股分开看 · HOOD 仅作辅助'},
];
export const SYMBOLS = ['SPY','QQQ','VIX','RSP','SPMO','VIX3M','DRAM',...new Set(SECTORS.flatMap(s=>[...s.members,...(s.coins||[]),...(s.aux||[])]))];
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
  const {assets:a,meta:m,breadth:b}=data,qs=['QQQ','SPY'].map(s=>a[s]);
  const price=qs.every(q=>validQuote(q,m))?direction(qs):'unknown';
  const breadthOK=['verified','snapshot'].includes(b?.status)&&b.marketDate===m.marketDate&&finite(b.upPct)&&b.upPct>=0&&b.upPct<=100;
  const breadth=breadthOK?(b.upPct>=55?'up':b.upPct<=45?'down':'mixed'):'unknown';
  const participation=relativeRatio(a.RSP,a.SPY,m),momentum=relativeRatio(a.SPMO,a.SPY,m);
  const vixOK=validQuote(a.VIX,m),termOK=vixOK&&validQuote(a.VIX3M,m)&&aligned(a.VIX,a.VIX3M);
  const termRatio=termOK?a.VIX.price/a.VIX3M.price:null;
  const volatility=!vixOK?'unknown':termRatio!==null&&termRatio>=1?'stress':a.VIX.changePct>0?'rising':'easing';
  const volDirection=volatility==='unknown'?'unknown':volatility==='easing'?'up':'down';
  const directional=['up','down'].includes(price);
  const support=directional?[breadth,volDirection].filter(x=>x===price).length:0;
  const opposition=directional?[breadth,volDirection].filter(x=>['up','down'].includes(x)&&x!==price).length:0;
  const vwapConfirmed=directional&&qs.every(q=>finite(q.vwapApprox)&&(price==='up'?q.price>=q.vwapApprox:q.price<=q.vwapApprox));
  const state=price==='unknown'?'UNKNOWN':!directional||opposition===2?'MIXED':price==='up'?'RISK_ON':'RISK_OFF';
  let confidence='低';
  if(directional&&support>=1&&opposition===0&&breadthOK&&vixOK&&termOK)confidence='中';
  if(support===2&&vwapConfirmed&&termOK&&participation.trend===price&&b.status==='verified')confidence='高';
  if(state==='MIXED'&&breadthOK&&vixOK)confidence='中';
  const priceText={up:'指数短线结构向上',down:'指数短线结构向下',mixed:'QQQ 与 SPY 结构尚未共振',unknown:'指数结构证据不足'}[price];
  const breadthText={up:'上涨参与度占优',down:'下跌参与度占优',mixed:'涨跌参与度接近',unknown:'广度待确认'}[breadth];
  const volatilityText={stress:'短期波动压力高于三个月',rising:'波动预期上升',easing:'波动预期缓和',unknown:'波动数据待确认'}[volatility];
  const caveat=opposition===2?'两项确认信号与价格相反，保留分化。':!termOK?'期限压力待确认，降低置信度。':!breadthOK?'广度缺失，倾向仅供观察。':opposition?'存在反向证据，倾向尚未确认。':!vwapConfirmed&&directional?'日内均价尚未确认同向。':'以完整30分钟结构描述当前倾向。';
  return {state,price,breadth,volatility,confidence,participation,momentum,termRatio,vwapConfirmed,support,opposition,
    explanation:`${priceText}；${breadthText}；${volatilityText}。`,caveat};
}
export function relativeRatio(q,benchmark,meta){
  if(!validQuote(q,meta)||!validQuote(benchmark,meta)||!aligned(q,benchmark)||!finite(q.baselinePrice)||q.baselinePrice<=0||!finite(benchmark.baselinePrice)||benchmark.baselinePrice<=0)return {level:null,changePct:null,trend:'unknown'};
  const changePct=((q.price/q.baselinePrice)/(benchmark.price/benchmark.baselinePrice)-1)*100;
  return {level:q.price/benchmark.price,changePct,trend:changePct>.2?'up':changePct<-.2?'down':'mixed'};
}
export function sectorInsights(def,data){
  const s=sectorState(def,data),old=data.previous?sectorState(def,data.previous):null;
  const a=data.assets,qs=def.members.map(x=>a[x]);
  const trendCount=s.complete?qs.filter(q=>q.trend30m===s.trend).length:0;
  let structure=s.trend==='unknown'?'样本结构不足，暂不判断板块共振。':s.trend==='mixed'?'内部方向存在分歧，暂未形成板块共振。':`${trendCount}/${s.total} 只样本的30分钟结构${s.trend==='up'?'向上':'向下'}，${s.trend==='up'?'强势':'弱势'}具有一定共性。`;
  if(s.complete){const sorted=[...qs].sort((x,y)=>y.changePct-x.changePct);structure+=` ${sorted[0].symbol} 当轮相对领先，${sorted.at(-1).symbol} 落后。`}
  if(def.id==='memory'&&s.complete){const mem=direction([a.MU,a.SKHY]);structure+=` 内存端${LABELS[mem]}；WDC 的独立表现不代表 DRAM 整体。`}
  if(def.coins)structure+=` 币价${LABELS[s.coinTrend]}、股票${LABELS[s.trend]}${s.split?'，两者尚未共振':'，分别确认'}；HOOD 不计分。`;
  let delta='首次建立基线，尚无可比较的上轮结构。';
  if(old){delta=`较上轮结构${compare(s.trend,old.trend)}。`;if(finite(s.relative)&&finite(old.relative)){
    const diff=s.relative-old.relative;delta+=` 相对 QQQ 表现${diff>=0?'改善':'走弱'} ${Math.abs(diff).toFixed(2)} 个百分点${data.previous.meta.marketDate!==data.meta.marketDate?'（跨交易日窗口，不作连续资金流解读）':''}。`}}
  const thresholds=def.anchor?'DRAM 与至少3/4只代表股':def.coins?'BTC / ETH 与 COIN / MSTR':'至少'+Math.ceil(def.members.length*2/3)+'/'+def.members.length+'只样本';
  const condition=s.trend==='up'?`若${thresholds}不再保持向上结构，转为分化或下调；相对 QQQ 走弱另作提醒。`:s.trend==='unknown'?`先补齐同一时点行情，再看${thresholds}能否形成同向结构。`:`若${thresholds}形成向上结构，可上调自身走势；同时跑赢 QQQ 才上调相对强弱。`;
  return {structure,delta,condition};
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
