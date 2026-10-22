import {normalizeLogs,stableId} from './record-ids.mjs';
const ms=s=>+new Date(s),windowMs=600000;
const iso=n=>{const d=new Date(n);return new Date(n-d.getTimezoneOffset()*60000).toISOString().slice(0,23);};
export function reconcileCompletions(input, source, timer={}){
 const logs=normalizeLogs(input).map(x=>({...x,eventIds:[...(x.eventIds||[])]})),events=structuredClone(source);
 const owners=new Map(Object.values(events).map(e=>[e.id,e._recordId]));
 for(const x of logs){
  if(x.activityId!=='__jjogaera_work__'||Object.hasOwn(x,'autoCompletion')||x.kind==='completion')continue;
  const a=ms(x.start),b=ms(x.stop);if(!(b-a>=0&&b-a<60000))continue;
  const nearby=Object.values(events).some(e=>ms(e.localTime)>=a-windowMs&&ms(e.localTime)<=b+windowMs);
  const activity=logs.some(y=>y.activityId!=='__jjogaera_work__'&&y.kind!=='completion'&&ms(y.start)<=b+windowMs&&ms(y.stop)>=a-windowMs);
  if(Object.values(events).some(e=>e._recordId===x.id)||(nearby&&activity)){x.autoCompletion=true;x.start=iso(b-windowMs);}
 }
 const groups=new Map(logs.filter(x=>x.kind==='completion').map(x=>[x.id,x]));
 const live=timer.running&&timer.startIso?{id:'live:'+timer.startIso,start:timer.startIso,stop:null}:null;

 for(const e of Object.values(events).sort((a,b)=>a.completedAt-b.completedAt||a.id.localeCompare(b.id))){
  if(e._groupId&&!groups.has(e._groupId))continue;
  if(e._placementVersion===2&&e._recordId&&!logs.some(x=>x.id===e._recordId)&&e._recordId!==live?.id&&!e._recordId.startsWith('live:'))continue;
  if(e._recordId?.startsWith('live:')&&e._recordId!==live?.id&&!logs.some(x=>x.kind!=='completion'&&(ms(x.start)===ms(e._recordId.slice(5))||(ms(x.start)<=ms(e.localTime)&&ms(e.localTime)<ms(x.stop)))))continue;
  const t=ms(e.localTime),candidates=[...logs.filter(x=>x.kind!=='completion'),...(live?[live]:[])];
  const score=x=>{const a=ms(x.start),b=x.stop?ms(x.stop):Math.max(t,Date.now())+1;return a<=t&&t<b?[0,0,0]:[1,Math.min(Math.abs(t-a),Math.abs(t-b)),b<=t?0:1];};
  const cmp=(a,b)=>{const x=score(a),y=score(b);return Number(!!a.autoCompletion)-Number(!!b.autoCompletion)||x[0]-y[0]||x[1]-y[1]||x[2]-y[2]||a.id.localeCompare(b.id);};
  const eligible=candidates.filter(x=>score(x)[1]<=windowMs);let target=eligible.filter(x=>!x.autoCompletion).sort(cmp)[0]||eligible.find(x=>x.id===e._recordId)||eligible.sort(cmp)[0];
  if(!target){target={id:'completion_activity_'+stableId(e.id),index:logs.length,start:iso(t-windowMs),stop:iso(t),activityId:'__jjogaera_work__',note:'',realized:false,autoCompletion:true,eventIds:[]};logs.push(target);}
  if(e._groupId){const g=groups.get(e._groupId);if(g.note)e._placementMemo=g.note;delete e._groupId;}
  e._recordId=target.id;e._placementVersion=2;e._placed=true;
 }
 for(const g of groups.values())if(g.note&&!Object.values(events).some(e=>e._placementMemo===g.note)){
  const t=ms(g.stop),near=logs.filter(x=>x.kind!=='completion').map(x=>({x,d:Math.min(Math.abs(t-ms(x.start)),Math.abs(t-ms(x.stop)))})).filter(x=>x.d<=windowMs).sort((a,b)=>a.d-b.d)[0]?.x;
  if(near){const memo='[완료 기록 메모 '+g.id+']\n'+g.note;if(!(near.note||'').includes(memo))near.note=[near.note,memo].filter(Boolean).join('\n');g.note='';}
  else {g.kind='activity';g.start=iso(t-windowMs);g.autoCompletion=false;}
 }
 for(const x of logs)if(x.autoCompletion&&x.note&&!Object.values(events).some(e=>e._recordId===x.id)){
  const moved=Object.values(events).filter(e=>owners.get(e.id)===x.id&&e._recordId);
  if(moved.length){const memo='[완료 기록 메모 '+x.id+']\n'+x.note;const e=moved[0];if(!(e._placementMemo||'').includes(memo))e._placementMemo=[e._placementMemo,memo].filter(Boolean).join('\n');x.note='';}
 }
 const retained=logs.filter(x=>(x.kind!=='completion'||Object.values(events).some(e=>e._groupId===x.id))&&(!x.autoCompletion||x.note||Object.values(events).some(e=>e._recordId===x.id)));
 return {logs:retained.map((x,index)=>({...x,index})),events};
}
