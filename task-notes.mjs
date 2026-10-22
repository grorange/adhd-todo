import {reconcileCompletions} from './completion-placement.mjs';
import {normalizeLogs,stableId} from './record-ids.mjs';
export function receiveTaskNotes(records,payload){
 const next=structuredClone(records),events={...(next.jjogaera_events?.values||{})},incoming=payload?.events;
 if(!Array.isArray(incoming)||!incoming.length||incoming.length>200)throw Error('한 번에 1~200개 기록을 보내세요.');
 const accepted=[];const logs=normalizeLogs(next.timelog?.items||[]),activities=next.activities?.items||[],timer=next.timer||{};
 for(const a of activities)if(a.id==='__jjogaera_work__'){if(a.name==='쪼개라 작업')a.name='기본작업';if(a.color==='#635bda')a.color='#ffffff';}
 const iso=d=>new Date(d-d.getTimezoneOffset()*60000).toISOString().slice(0,23);
 for(const raw of [...incoming].sort((a,b)=>a.completedAt-b.completedAt||(String(a.id)<String(b.id)?-1:String(a.id)>String(b.id)?1:0))){
  for(const key of ['id','taskId','projectId','projectName','text'])if(typeof raw[key]!=='string'||!raw[key]||raw[key].length>(key==='text'?3000:300))throw Error('잘못된 작업 기록입니다.');
  if(!/^[A-Za-z0-9_-]+$/.test(raw.id)||typeof raw.completedAt!=='number'||!Number.isFinite(raw.completedAt)||raw.completedAt>Date.now()+300000||raw.completedAt<0)throw Error('잘못된 완료 시각 또는 ID입니다.');
  for(const key of ['path','milestones'])if(raw[key]&&(!Array.isArray(raw[key])||raw[key].length>100||raw[key].some(x=>typeof x!=='string'||x.length>3000)))throw Error('잘못된 작업 경로입니다.');
  if(!['done','gaveup'].includes(raw.status||'done'))throw Error('잘못된 작업 상태입니다.');
  const e={id:raw.id,taskId:raw.taskId,projectId:raw.projectId,projectName:raw.projectName,text:raw.text,completedAt:raw.completedAt,status:raw.status||'done',path:raw.path||[],milestones:raw.milestones||[],localTime:iso(new Date(raw.completedAt)),nonProject:!!raw.nonProject};
  if(events[e.id]){if(['taskId','projectId','projectName','text','completedAt','status','nonProject','path','milestones'].some(key=>JSON.stringify(events[e.id][key]??(key==='nonProject'?false:[]))!==JSON.stringify(e[key])))throw Error('같은 ID에 다른 기록이 있습니다.');accepted.push(e.id);continue;}
  events[e.id]={...e,_placed:true};accepted.push(e.id);
 }
 const placed=reconcileCompletions(logs,events,timer);if(placed.logs.some(x=>x.activityId==='__jjogaera_work__')&&!activities.some(x=>x.id==='__jjogaera_work__'))activities.push({id:'__jjogaera_work__',name:'기본작업',color:'#ffffff',icon:''});next.jjogaera_events={values:placed.events};next.timelog={items:placed.logs};next.activities={items:activities};return {records:next,acceptedIds:accepted};
}
