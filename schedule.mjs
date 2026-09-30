const DAY=86400000;
export function localDay(time,timezone='America/New_York') {
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(time));
  const p=Object.fromEntries(parts.map(x=>[x.type,x.value]));return `${p.year}-${p.month}-${p.day}`;
}
export function zonedTime(day,time,timezone='America/New_York') {
  const [y,m,d]=day.split('-').map(Number),[h,min]=time.split(':').map(Number);
  const target=Date.UTC(y,m-1,d,h,min);let guess=target;
  for(let i=0;i<3;i++){
    const parts=new Intl.DateTimeFormat('en-US',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(guess));
    const p=Object.fromEntries(parts.map(x=>[x.type,x.value]));
    const rendered=Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute,+p.second);
    guess+=target-rendered;
  }return guess;
}
export function tradingDay(day,schedule) {
  if(!schedule||day<schedule.validFrom||day>schedule.validThrough)return null;
  const weekday=new Date(day+'T12:00:00Z').getUTCDay();
  return weekday!==0&&weekday!==6&&!schedule.holidays.includes(day)&&!(schedule.closures||[]).includes(day);
}
export function slotsAround(now,schedule) {
  if(!schedule)return [];
  const current=localDay(now,schedule.timezone),middle=Date.parse(current+'T12:00:00Z'),slots=[];
  for(let offset=-10;offset<=10;offset++){
    const day=new Date(middle+offset*DAY).toISOString().slice(0,10);
    if(tradingDay(day,schedule)!==true)continue;
    for(const [rank,s] of schedule.sessions.entries())slots.push({...s,rank,marketDate:day,at:zonedTime(day,s.time,schedule.timezone)});
  }return slots.sort((a,b)=>a.at-b.at);
}
export function covers(meta,slot,schedule) {
  if(!slot||!meta)return false;
  const rank=schedule.sessions.findIndex(s=>s.id===meta.session);
  const updated=Date.parse(meta.updatedAt);
  return meta.marketDate===slot.marketDate&&rank>=slot.rank&&Number.isFinite(updated)&&(rank>slot.rank||updated>=slot.at-60000);
}
export function updateHealth(meta,schedule,now=Date.now(),lastAttempt=null) {
  if(meta?.automationEnabled===false)return {state:'paused',label:'自动更新已暂停',next:null,due:null};
  if(!schedule||tradingDay(localDay(now,schedule.timezone),schedule)===null)return {state:'unknown',label:'更新日程待确认',next:null,due:null};
  const slots=slotsAround(now,schedule),grace=(schedule.graceMinutes||15)*60000;
  const next=slots.find(s=>s.at>now)||null,due=slots.filter(s=>s.at+grace<=now).at(-1)||null;
  const pending=slots.filter(s=>s.at<=now&&s.at+grace>now).at(-1);
  let state='ready',label='更新正常';
  if(due&&!covers(meta,due,schedule)){state='overdue';label=`${due.name}更新逾期`;}
  else if(pending&&!covers(meta,pending,schedule)){state='pending';label=`等待${pending.name}更新`;}
  else if(meta?.updateStatus==='partial'||meta?.missing?.length){state='partial';label='部分完成';}
  if(lastAttempt?.status==='failed'&&lastAttempt.marketDate===due?.marketDate&&lastAttempt.session===due?.id&&!covers(meta,due,schedule)){state='failed';label=`${due.name}更新失败`;}
  return {state,label,next,due};
}
