export function receiveTaskNotes(records,payload){
 const next=structuredClone(records),events={...(next.jjogaera_events?.values||{})},incoming=payload?.events;
 if(!Array.isArray(incoming)||!incoming.length||incoming.length>200)throw Error('한 번에 1~200개 기록을 보내세요.');
 const accepted=[];const logs=next.timelog?.items||[],activities=next.activities?.items||[],timer=next.timer||{};
 for(const a of activities)if(a.id==='__jjogaera_work__'&&a.name==='쪼개라 작업')a.name='기본작업';
 const iso=d=>new Date(d-d.getTimezoneOffset()*60000).toISOString().slice(0,23);
 for(const raw of incoming){
  for(const key of ['id','taskId','projectId','projectName','text'])if(typeof raw[key]!=='string'||!raw[key]||raw[key].length>(key==='text'?3000:300))throw Error('잘못된 작업 기록입니다.');
  if(!/^[A-Za-z0-9_-]+$/.test(raw.id)||typeof raw.completedAt!=='number'||!Number.isFinite(raw.completedAt)||raw.completedAt>Date.now()+300000||raw.completedAt<0)throw Error('잘못된 완료 시각 또는 ID입니다.');
  for(const key of ['path','milestones'])if(raw[key]&&(!Array.isArray(raw[key])||raw[key].length>100||raw[key].some(x=>typeof x!=='string'||x.length>3000)))throw Error('잘못된 작업 경로입니다.');
  if(!['done','gaveup'].includes(raw.status||'done'))throw Error('잘못된 작업 상태입니다.');
  const e={id:raw.id,taskId:raw.taskId,projectId:raw.projectId,projectName:raw.projectName,text:raw.text,completedAt:raw.completedAt,status:raw.status||'done',path:raw.path||[],milestones:raw.milestones||[],localTime:iso(new Date(raw.completedAt)),nonProject:!!raw.nonProject};
  if(events[e.id]){if(['taskId','projectId','projectName','text','completedAt','status','nonProject','path','milestones'].some(key=>JSON.stringify(events[e.id][key]??(key==='nonProject'?false:[]))!==JSON.stringify(e[key])))throw Error('같은 ID에 다른 기록이 있습니다.');accepted.push(e.id);continue;}
  const t=e.localTime,live=timer.running&&timer.startIso;
  if(!logs.some(x=>x.start<=t&&t<x.stop)&&!(live&&live<=t)){
   const aid='__jjogaera_work__';if(!activities.some(x=>x.id===aid))activities.push({id:aid,name:'기본작업',color:'#635bda',icon:''});
   let start=iso(new Date(e.completedAt-300000)),stop=iso(new Date(e.completedAt+1));start=[start,t.slice(0,10)+'T00:00:00.000',...logs.filter(x=>x.stop<=t).map(x=>x.stop)].sort().at(-1);
   const future=logs.filter(x=>x.start>t).map(x=>x.start);if(live&&live>t)future.push(live);stop=[stop,...future].sort()[0];
   logs.push({index:logs.length,start,stop,activityId:aid,note:'',realized:false});
  }
  events[e.id]={...e,_placed:true};accepted.push(e.id);
 }
 next.jjogaera_events={values:events};next.timelog={items:logs};next.activities={items:activities};return {records:next,acceptedIds:accepted};
}
