import {SECTORS,LABELS,summarize,compare,validQuote,newsFor,sectorInsights} from './dashboard-model.mjs?v=18.2';
import {pulseErrors,industryLabel,pulseNews} from './sector-pulse.mjs?v=18.3';
const root=document.getElementById('dashboard');
let DATA=null,SORT='fixed';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeUrl=s=>/^https:\/\//.test(s||'')?esc(s):'#';
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const pct=n=>finite(n)?`${n>0?'+':''}${n.toFixed(2)}%`:'—';
const tone=n=>finite(n)?n>0?'up':n<0?'down':'flat':'muted';
const stateTone=s=>['up','RISK_ON'].includes(s)?'up':['down','RISK_OFF'].includes(s)?'down':s==='UNKNOWN'||s==='unknown'?'muted':'flat';
const fmt=(s,full=false)=>s?new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false,...(full?{year:'numeric'}:{})}).format(new Date(s)):'未提供';
const summaries={RISK_ON:['价格与广度同向走强','指数结构向上、上涨家数占优，波动压力同步缓和。'],RISK_OFF:['价格与广度同步偏弱','指数结构向下、下跌家数占优，波动压力上升。'],MIXED:['市场信号尚未形成共振','价格、参与度或波动表现存在分歧，分别观察四个板块。'],UNKNOWN:['部分证据仍待确认','保留已核实的行情，缺失证据不自动判为分化或低风险。']};
function spark(values,t='muted'){
  if(!values?.length||values.length<2)return '';
  const lo=Math.min(...values),hi=Math.max(...values),span=hi-lo||1;
  const pts=values.map((v,i)=>`${(i/(values.length-1)*100).toFixed(2)},${(42-(v-lo)/span*36).toFixed(2)}`).join(' ');
  return `<svg class="spark tone-${t}" viewBox="0 0 104 48" role="img" aria-label="本次正式盘价格走势，纵轴独立缩放"><line x1="0" y1="45" x2="104" y2="45" stroke="currentColor" opacity=".17"/><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
}
function chip(symbol,aux=false){
  const q=DATA.assets[symbol],good=validQuote(q,DATA.meta);
  return `<span class="ticker-chip" title="${esc(q?.name)} · ${good?fmt(q.asOf)+' 中国时间':'本轮缺少行情'}"><b>${symbol}</b><span class="tone-${good?tone(q.changePct):'muted'}">${good?pct(q.changePct):'—'}</span>${aux?'<span class="aux">辅助</span>':''}</span>`;
}
function sectorRow(def,s,old){
  const current=s.change,base=def.anchor?DATA.assets[def.anchor]:DATA.assets[def.members[0]];
  const insight=sectorInsights(def,DATA);
  const news=newsFor(DATA,def.id),change=compare(s.trend,old?.trend);
  const txt=def.id==='memory'?`DRAM ${pct(current)}；${s.advancing}/${s.total} 只代表股上涨${s.trend==='mixed'?'，整体与内部表现存在分歧。':'。'}`:def.id==='crypto'?`加密股票 ${LABELS[s.trend]}，币价 ${LABELS[s.coinTrend]}${s.split?'；币与股走势分化。':'。'}`:`${s.advancing}/${s.total} 只样本上涨；30 分钟结构${s.trend==='mixed'?'存在分歧':s.trend==='unknown'?'仍待确认':'整体'+LABELS[s.trend]}。`;
  const relative=finite(s.relative)?`${s.relative>0?'+':''}${s.relative.toFixed(2)} 个百分点`:'口径未对齐';
  const newsLabel=news?`${news.label||'最新催化'} · ${news.kind==='reported'?'已核实事件':'联动推断'}`:'本轮观察';
  return `<article class="sector-row" id="sector-${def.id}" aria-labelledby="name-${def.id}"><div class="sector-main">
    <div><div class="sector-title"><span class="sector-number">${def.number}</span><div><h3 id="name-${def.id}">${def.name}</h3><div class="sector-en">${def.en}</div></div></div><div class="sector-state"><strong class="tone-${stateTone(s.trend)}">${LABELS[s.trend]}</strong><small>${change==='首次记录'?'建立基线':change+' · 较上次'}</small></div>${def.coins?`<div class="coin-line">币价 <b class="tone-${stateTone(s.coinTrend)}">${LABELS[s.coinTrend]}</b> / 股票 <b class="tone-${stateTone(s.trend)}">${LABELS[s.trend]}</b></div>`:''}</div>
    <div><div class="performance"><div><div class="performance-label">${def.anchor?'DRAM 整体':def.coins?'COIN / MSTR 等权':'样本等权涨跌'}</div><div class="performance-number tone-${tone(current)}">${pct(current)}</div></div>${def.anchor?spark(base?.spark,tone(current)):basketSpark(def,tone(current))}</div><div class="performance-meta"><b class="tone-${tone(s.relative)}">${s.relativeLabel}</b><span>·</span><span>较 QQQ ${relative}</span></div></div>
    <div class="sector-note"><dl class="sector-analysis"><div><dt>结构</dt><dd>${esc(insight.structure)}</dd></div><div><dt>变化</dt><dd>${esc(insight.delta)}</dd></div><div><dt>观察</dt><dd>${esc(insight.condition)}</dd></div></dl>${news?`<div class="sector-news"><div class="news-heading">${esc(newsLabel)} · ${esc(news.publishedAt.slice(5,10))}</div><p>${esc(news.text)}</p><p class="secondary">${news.afterSnapshot?'快照后消息，价格反应待确认。':esc(news.priceRelation||'事件与当轮涨跌的因果尚未证实。')}</p><a class="note-source" href="${safeUrl(news.sources[0].url)}" target="_blank" rel="noopener noreferrer">${esc(news.sources[0].name)} ↗</a></div>`:'<p class="secondary">消息：暂无有效的新催化；不以新闻代替价格确认。</p>'}</div>
    </div><div class="sector-bottom"><div class="ticker-list">${(def.coins||[]).map(s=>chip(s)).join('')}${def.coins?'<span class="ticker-separator">｜</span>':''}${def.members.map(s=>chip(s)).join('')}${(def.aux||[]).map(s=>chip(s,true)).join('')}</div><span class="participation">${s.complete?`${s.advancing} / ${s.total} 只上涨`:`${s.count} / ${s.total} 只行情可用`}</span></div></article>`;
}
function basketSpark(def,t){
  const qs=def.members.map(s=>DATA.assets[s]);
  if(!qs.every(q=>validQuote(q,DATA.meta)&&q.spark?.length>1))return '';
  const n=qs[0].spark.length;
  if(!qs.every(q=>q.spark.length===n))return '';
  return spark(Array.from({length:n},(_,i)=>qs.reduce((a,q)=>a+q.spark[i]/q.baselinePrice,0)/qs.length),t);
}
function industryBoard(){
  const p=DATA.sectorPulse,errors=pulseErrors(p,DATA.meta);
  const heading='<div class="section-head"><div><h2 id="industry-heading">板块涨跌榜 <small>SECTOR MOVERS</small></h2></div></div>';
  if(errors.length||p.status==='unavailable')return `<section class="industry-section" aria-labelledby="industry-heading">${heading}<p class="industry-caption">${esc(p?.status==='unavailable'?p.note:errors.join('；'))}</p></section>`;
  const group=(side,isUp)=>`<div class="industry-group"><h3 class="tone-${isUp?'up':'down'}">${isUp?'涨幅前三 ↗':'跌幅前三 ↘'}</h3><ol>${p[side].map((r,i)=>{
    const n=pulseNews(p,r.name),pending=p.news?.[r.name]?.kind==='unknown';
    return `<li><div class="industry-title"><span class="industry-rank">0${i+1}</span><b title="${esc(r.name)}">${esc(industryLabel(r.name))}</b><strong class="tone-${isUp?'up':'down'}">${pct(r.changePct)}</strong></div><p class="industry-news">${esc(n?.text||(pending?p.news[r.name].text:'新闻待核实，暂不解释本轮涨跌。'))}</p>${n?`<div class="industry-source">${n.publishedAt.slice(5,10)} · ${n.kind==='inference'?'联动推断':'新闻线索'}${n.afterSnapshot?' · 快照后消息，价格反应待确认':''} · ${n.sources.map(s=>`<a href="${safeUrl(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.name)} ↗</a>`).join(' / ')}</div>`:'<div class="industry-source">原因待核实</div>'}</li>`;
  }).join('')}</ol>${p[side].length<3?`<p class="industry-caption">该方向仅 ${p[side].length} 个行业，不足三项。</p>`:''}</div>`;
  return `<section class="industry-section" aria-labelledby="industry-heading">${heading}<p class="industry-caption">${esc(p.marketDate)} · ${DATA.meta.priceBasis==='close'?'正式盘收盘日涨跌':'当日累计涨跌'} · ${p.universeCount} 个细分行业 <a href="${safeUrl(p.sourceUrl)}" target="_blank" rel="noopener noreferrer">排名来源 ↗</a></p><div class="industry-grid">${group('gainers',true)}${group('losers',false)}</div><p class="industry-caption industry-footnote">抓取 ${fmt(p.fetchedAt)} 中国时间 · 来源可能延迟，未提供精确行情时刻；非两轮更新间涨跌。${p.researchAt?' 新闻核实 '+fmt(p.researchAt):''}</p></section>`;
}
function render(){
  const m=DATA.meta,a=DATA.assets,b=DATA.breadth,result=summarize(DATA),market=result.market;
  const previous=DATA.previous?summarize(DATA.previous):null;
  const phase=m.priceBasis==='close'?'收盘快照':'盘中快照';
  const delta=DATA.previous&&DATA.previous.meta.rulesVersion!==m.rulesVersion?'规则升级':compare(market.state,previous?.market.state);
  const summary=[market.state==='RISK_ON'?'当前倾向进攻':market.state==='RISK_OFF'?'当前倾向防守':market.state==='MIXED'?'方向或确认信号存在分歧':'方向证据仍待补齐',market.explanation];
  const priceText={up:'同步走强',down:'同步走弱',mixed:'结构未共振',unknown:'待确认'}[market.price];
  const volGood=validQuote(a.VIX,m),breadthGood=['verified','snapshot'].includes(b.status)&&b.marketDate===m.marketDate;
  let defs=[...SECTORS];
  if(SORT==='relative')defs.sort((x,y)=>(result.sectors.find(s=>s.id===y.id).relative??-Infinity)-(result.sectors.find(s=>s.id===x.id).relative??-Infinity));
  const oldest=(Date.now()-Date.parse(m.asOf))/3600000>36;
  root.innerHTML=`<div class="snapshot-line"><div><strong>${esc(m.marketDate)} · ${phase}</strong><span> / 截至 ${fmt(m.asOf)} 中国时间${oldest?' · 历史快照':''}</span></div><div class="snapshot-controls"><span><i class="status-dot"></i>${m.automationEnabled?'定时更新已启用':'自动更新已暂停'}</span><button class="text-button" id="refresh">重新读取 ↻</button></div></div>
  <section class="hero" aria-labelledby="market-heading"><div class="eyebrow"><span id="market-heading">市场状态</span><span class="mono">MARKET REGIME</span></div><div class="hero-top"><div class="regime"><h1 class="tone-${stateTone(market.state)}">${['RISK_ON','RISK_OFF'].includes(market.state)?'<small>偏</small> ':''}${LABELS[market.state]}</h1><span class="badge tone-${stateTone(market.state)}">${['首次记录','规则升级'].includes(delta)?delta:delta+' · 较上次'}</span></div><div class="hero-summary"><h2>${summary[0]}</h2><p>${summary[1]}<br>证据置信度：${market.confidence} · ${esc(market.caveat)}</p></div></div>
  <div class="evidence-grid"><div class="evidence"><div class="evidence-label"><span>01 / 价格结构</span><span>30 MIN</span></div><div class="evidence-value tone-${stateTone(market.price)}">${priceText}<small>QQQ / SPY</small></div><p>完整 30 分钟 EMA20 结构定方向；均价作确认</p></div>
  <div class="evidence"><div class="evidence-label"><span>02 / 上涨参与度</span><span>BREADTH</span></div><div class="evidence-value ${breadthGood?'tone-'+stateTone(market.breadth):'tone-muted'}">${breadthGood?b.upPct.toFixed(1)+'%':'待确认'}<small>上涨占比 · 不含平盘</small></div><p>${breadthGood?`${b.advancing.toLocaleString()} 家上涨 / ${b.declining.toLocaleString()} 家下跌`:'未取得同一时段的可核实广度'}</p><p class="extra-evidence">RSP / SPY ${finite(market.participation.changePct)?'比值本轮 '+pct(market.participation.changePct):'同窗口数据待确认'}</p>${breadthGood?`<div class="breadth-track" aria-hidden="true"><i style="width:${b.upPct}%"></i><b style="width:${100-b.upPct}%"></b></div>`:''}</div>
  <div class="evidence"><div class="evidence-label"><span>03 / 波动压力</span><span>VIX</span></div><div class="evidence-value tone-${volGood?(a.VIX.changePct>0?'down':'up'):'muted'}">${volGood?a.VIX.price.toFixed(2):'—'}<small>${volGood?pct(a.VIX.changePct):'待确认'}</small></div><p>${volGood?(a.VIX.changePct>0?'波动预期上升':'波动预期缓和'):'缺少同一时点数据'} · ${market.termRatio!==null&&market.termRatio>=1?'短期压力偏高':'结合期限结构判断'}</p><p class="extra-evidence">VIX / VIX3M ${market.termRatio!==null?market.termRatio.toFixed(3)+(market.termRatio>=1?' · 短期高于三个月':' · 短期低于三个月'):'待确认'}</p></div></div>
  <div class="benchmark-strip">${['QQQ','SPY'].map(s=>`<div class="benchmark"><b>${s}</b><span class="tone-${tone(a[s].changePct)}">${pct(a[s].changePct)}</span></div>`).join('')}<span class="momentum-observation"><b>动量观察</b> SPMO / SPY ${finite(market.momentum.changePct)?'比值本轮 '+pct(market.momentum.changePct):'待确认'}<span>${market.momentum.trend==='unknown'?'缺数据不参与判断':market.momentum.trend==='up'?(a.SPY.changePct<0?'相对抗跌，不等于 Risk-on':'既有强势股相对领跑'):market.momentum.trend==='down'?'既有强势股相对落后，留意轮动':'相对表现接近'} · 辅助，不决定市场方向</span></span></div></section>
  ${industryBoard()}
  <section class="sectors-section" aria-labelledby="sectors-heading"><div class="section-head"><div><h2 id="sectors-heading">四个战场 <small>YOUR FOCUS</small></h2><p>自身走势与相对强弱，分开观察。</p></div><div class="sort-controls" role="group" aria-label="板块排序"><button data-sort="fixed" class="${SORT==='fixed'?'active':''}" aria-pressed="${SORT==='fixed'}">固定顺序</button><button data-sort="relative" class="${SORT==='relative'?'active':''}" aria-pressed="${SORT==='relative'}">相对强弱</button></div></div><div class="sector-list">${defs.map(def=>sectorRow(def,result.sectors.find(s=>s.id===def.id),previous?.sectors.find(s=>s.id===def.id))).join('')}</div></section>
  <p class="quality-note">${m.automationEnabled?'':'试用期间保留最近快照；重新读取不会触发行情研究。'} ${breadthGood?'广度为页面快照，来源未提供精确行情时刻。':''}</p>
  <details class="methodology"><summary><span>观察口径、监测名单与数据来源</span><span class="mono">METHOD / SOURCES</span></summary><div class="methodology-body"><p><b>市场状态。</b>QQQ 与 SPY 的完整30分钟 EMA20 趋势同向决定 Risk-on/off 倾向；指数不共振显示分化，指数缺证显示待确认。广度上涨占比 ≥55% / ≤45% 为支持向上 / 向下；VIX 上涨或 VIX/VIX3M ≥1 为压力增加，否则 VIX 不涨为压力缓和。广度与波动都反对价格方向时显示分化；一项反对或缺少关键确认时保留低置信度倾向。均价作为额外确认，不单独否决方向。</p><p><b>三个新增观察。</b>RSP/SPY 与 SPMO/SPY 展示同一上一正式盘收盘至快照的比值变化，±0.2% 内视为接近，不等于资金流或长期趋势。RSP 辅助衡量参与程度；SPMO 只解释既有强势风格，不独立改变市场方向。VIX/VIX3M 是约30天和三个月隐含波动率的比值，不是期货曲线；≥1仅表示短期压力较高，不能预测下跌。所有比值须同一时点，缺数不填零。</p><p><b>置信度。</b>指证据一致性，不是上涨概率：方向获至少一项支持、无反向、广度和两项波动指标齐备时为中；再有两项支持、均价与RSP确认、广度带精确时点才为高。数据缺失或单项反向为低。规则未经收益回测；升级规则时不冒称市场改善或恶化。</p><p><b>板块。</b>存储以 DRAM 为整体，MU / SKHY / SNDK / WDC 作内部验证；新云与太空为固定样本等权涨跌。至少三分之二样本的 30 分钟趋势同向才称走强／走弱；缺失样本不默默缩小分母。自身下跌但跑赢 QQQ 仍会同时显示负涨幅。相对 QQQ 在 ±0.2 个百分点内记为接近大盘。</p><p><b>币与股。</b>BTC / ETH 独立判断，不与股票平均；币价涨跌也统一较上一美股交易日收盘至本次快照，非滚动24小时。HOOD 仅辅助、不计入加密股票强弱。IREN 只在新云计数。小图展示同一正式盘窗口，各自纵轴缩放。</p><p><b>消息与变化。</b>消息须有原始日期和来源；没有新证据不凑归因。价格反应与事件因果分开。首次记录不冒充改善／恶化。CTA 仅在有可追溯仓位估算时补充，不影响基础分类。</p><p><b>时效。</b>快照截至 ${fmt(m.asOf,true)} 中国时间；本轮抓取 ${fmt(m.updatedAt,true)}。数据来自 Yahoo Finance 完整30分钟K线，股票收盘价使用来源的同日正式盘收盘字段校对；近似均价由HLC3与成交量计算，并非逐笔精确VWAP。收盘时 VIX 使用与美股对齐的收盘时点快照，不等于 VIX 自身的最终收盘值。<a href="https://finviz.com/" target="_blank" rel="noopener noreferrer">Finviz 广度 ↗</a>：${esc(b.note)}</p><div class="source-table-wrap"><table class="source-table"><thead><tr><th>样本</th><th>价格</th><th>涨跌</th><th>行情时点（中国时间）</th><th>来源</th></tr></thead><tbody>${Object.values(a).map(q=>`<tr><td>${esc(q.symbol)}</td><td>${finite(q.price)?q.price.toLocaleString('en-US',{maximumFractionDigits:2}):'—'}</td><td>${pct(q.changePct)}</td><td>${fmt(q.asOf)}</td><td>${q.sourceUrl?`<a href="${safeUrl(q.sourceUrl)}" target="_blank" rel="noopener noreferrer">行情原始数据 ↗</a>`:esc(q.note)}</td></tr>`).join('')}</tbody></table></div></div></details>`;
  root.setAttribute('aria-busy','false');
  document.getElementById('refresh').addEventListener('click',()=>load(true));
  root.querySelectorAll('[data-sort]').forEach(button=>button.addEventListener('click',()=>{SORT=button.dataset.sort;render()}));
}
async function load(refresh=false){
  if(refresh){const b=document.getElementById('refresh');b.disabled=true;b.textContent='读取中…'}
  try{const r=await fetch(`data.json?v=${Date.now()}`,{cache:'no-store'});if(!r.ok)throw Error('HTTP '+r.status);const d=await r.json();if(d.meta?.schemaVersion!==18||!d.assets)throw Error('数据版本不匹配');DATA=d;render();if(refresh){const b=document.getElementById('refresh');b.textContent='已读取最近快照 ✓';setTimeout(()=>{if(b.isConnected)b.textContent='重新读取 ↻'},2300)}}
  catch(e){if(refresh&&DATA){const b=document.getElementById('refresh');b.disabled=false;b.textContent='读取失败，点击重试'}else{root.innerHTML=`<div class="error" role="alert"><b>暂时无法读取市场快照</b><p>${esc(e.message)}</p><button class="theme-toggle" id="retry">重试</button></div>`;root.setAttribute('aria-busy','false');document.getElementById('retry').onclick=()=>load()}}
}
const toggle=document.getElementById('theme-toggle');
function themeLabel(){toggle.innerHTML=(document.documentElement.dataset.theme==='dark'?'浅色模式':'深色模式')+' <span>◐</span>'}
toggle.onclick=()=>{const t=document.documentElement.dataset.theme==='dark'?'light':'dark';document.documentElement.dataset.theme=t;try{localStorage.setItem('market-v18-theme',t)}catch{}themeLabel()};
themeLabel();load();
