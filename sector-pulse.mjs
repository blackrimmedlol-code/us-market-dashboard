// Rank logic adapted from legacy/sector-model.js; top three, no generated causes.
const labels={
  'Diagnostics & Research':'诊断与研究','Internet Content & Information':'互联网内容与信息',
  'Furnishings, Fixtures & Appliances':'家居与家电','Grocery Stores':'食品零售',
  'Health Information Services':'医疗信息服务','Solar':'太阳能','Paper & Paper Products':'纸与纸制品',
  'Electronics & Computer Distribution':'电子与计算机分销','Integrated Freight & Logistics':'综合货运与物流',
  'Uranium':'铀','Semiconductors':'半导体','Semiconductor Equipment & Materials':'半导体设备与材料',
  'Computer Hardware':'计算机硬件','Electronic Components':'电子元件','Consumer Electronics':'消费电子',
  'Software - Infrastructure':'基础软件','Software - Application':'应用软件',
  'Information Technology Services':'信息技术服务','Communication Equipment':'通信设备',
  'Aerospace & Defense':'航空航天与国防','Gold':'黄金','Silver':'白银','Copper':'铜',
  'Other Precious Metals & Mining':'其他贵金属与采矿','Other Industrial Metals & Mining':'工业金属与采矿',
  'Oil & Gas E&P':'油气勘探与生产','Oil & Gas Integrated':'综合油气',
  'Oil & Gas Equipment & Services':'油气设备与服务','Oil & Gas Midstream':'油气中游',
  'Oil & Gas Refining & Marketing':'炼油与销售','Oil & Gas Drilling':'油气钻探','Thermal Coal':'动力煤',
  'Chemicals':'化工','Specialty Chemicals':'特种化工','Steel':'钢铁','Aluminum':'铝',
  'Biotechnology':'生物科技','Drug Manufacturers - General':'大型制药',
  'Drug Manufacturers - Specialty & Generic':'专科与仿制药','Medical Devices':'医疗器械',
  'Medical Instruments & Supplies':'医疗仪器与耗材','Healthcare Plans':'医疗保险',
  'Banks - Regional':'区域银行','Banks - Diversified':'综合银行','Capital Markets':'资本市场',
  'Asset Management':'资产管理','Financial Data & Stock Exchanges':'金融数据与交易所',
  'Credit Services':'信贷服务','Insurance - Life':'人寿保险','Insurance - Property & Casualty':'财产与意外险',
  'Auto Manufacturers':'汽车制造','Auto Parts':'汽车零部件','Auto & Truck Dealerships':'汽车经销',
  'Travel Services':'旅游服务','Airlines':'航空公司','Resorts & Casinos':'度假村与赌场',
  'Lodging':'酒店','Restaurants':'餐饮','Internet Retail':'互联网零售','Specialty Retail':'专业零售',
  'Discount Stores':'折扣零售','Luxury Goods':'奢侈品','Apparel Retail':'服装零售',
  'Advertising Agencies':'广告代理','Entertainment':'娱乐','Gaming & Multimedia':'游戏与多媒体',
  'Utilities - Renewable':'可再生能源公用事业','Utilities - Regulated Electric':'电力公用事业',
  'Electrical Equipment & Parts':'电气设备与零部件','Specialty Industrial Machinery':'专用工业机械',
  'Engineering & Construction':'工程与建筑','Building Materials':'建材','Residential Construction':'住宅建筑',
  'REIT - Data Centers':'数据中心 REIT','REIT - Office':'办公 REIT','REIT - Retail':'零售 REIT',
  'Real Estate Services':'房地产服务','Marine Shipping':'海运','Railroads':'铁路','Trucking':'卡车运输'
};
export const industryLabel=name=>labels[name]||name;
export function rankIndustries(rows){
  if(!Array.isArray(rows)||!rows.length||new Set(rows.map(x=>x.name)).size!==rows.length||rows.some(x=>!x.name||!Number.isFinite(x.changePct)))throw Error('行业样本缺失、重复或涨跌幅无效');
  const tie=(a,b)=>a.name<b.name?-1:a.name>b.name?1:0;
  return {gainers:rows.filter(x=>x.changePct>0).sort((a,b)=>b.changePct-a.changePct||tie(a,b)).slice(0,3),losers:rows.filter(x=>x.changePct<0).sort((a,b)=>a.changePct-b.changePct||tie(a,b)).slice(0,3)};
}
export function pulseErrors(p,meta){
  if(!p)return ['本轮行业榜待更新'];
  const errors=[];
  if(!['snapshot','unavailable'].includes(p.status))errors.push('行业榜状态无效');
  if(!Number.isFinite(Date.parse(p.fetchedAt)))errors.push('行业榜缺少抓取时间');
  if(p.marketDate!==meta.marketDate)errors.push('行业榜与市场快照日期不同');
  const gap=Date.parse(meta.asOf)-Date.parse(p.targetAsOf);
  if(!Number.isFinite(gap)||gap<0||gap>=1800000)errors.push('行业榜与市场快照窗口不同');
  if(p.status==='unavailable')return p.note?errors:errors.concat('行业来源失败未说明原因');
  if(p.returnBasis!=='daily'||p.asOf!==null)errors.push('行业榜涨跌口径或时点标注错误');
  if(!p.sourceUrl?.startsWith('https://')||!p.dateBasis||p.universeCount!==p.rows?.length||p.universeCount<100)errors.push('行业范围或来源不完整');
  try{const ranks=rankIndustries(p.rows);for(const side of ['gainers','losers'])if(JSON.stringify(p[side])!==JSON.stringify(ranks[side]))errors.push('行业排名不匹配：'+side)}catch(e){errors.push(e.message)}
  const names=new Set([...(p.gainers||[]),...(p.losers||[])].map(x=>x.name));
  for(const [name,n] of Object.entries(p.news||{})){
    if(!names.has(name)||!n.text||n.text.length>240||!['reported','inference','unknown'].includes(n.kind))errors.push('行业新闻字段错误：'+name);
    if(!Number.isFinite(Date.parse(n.checkedAt))||!Number.isFinite(Date.parse(p.researchAt))||Date.parse(n.checkedAt)>Date.parse(p.researchAt))errors.push('行业新闻缺少核实时间：'+name);
    if(n.kind!=='unknown'&&(!Number.isFinite(Date.parse(n.publishedAt))||Date.parse(n.publishedAt)>Date.parse(n.checkedAt)||!Number.isFinite(Date.parse(n.expiresAt))||Date.parse(n.expiresAt)<=Date.parse(n.publishedAt)||!n.sources?.length||n.sources.length>2||n.sources.some(s=>!s.name||!s.url?.startsWith('https://'))))errors.push('行业新闻缺少有效日期或来源：'+name);
  }
  return errors;
}
export function pulseNews(p,name){
  const n=p?.news?.[name];
  if(!n?.text||n.kind==='unknown')return null;
  const when=Date.parse(p.researchAt||p.fetchedAt);
  if(Date.parse(n.publishedAt)>when||Date.parse(n.expiresAt)<when)return null;
  return {...n,afterSnapshot:n.publishedAt.includes('T')&&Date.parse(n.publishedAt)>Date.parse(p.targetAsOf)};
}
