// Pure data transformations shared by the browser and sync regression tests.
const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
export function equal(a,b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const ka=Object.keys(a).sort(), kb=Object.keys(b).sort();
  return ka.length===kb.length && ka.every((k,i)=>k===kb[i] && equal(a[k],b[k]));
}
function safeId(id) {
  if(typeof id!=='string' || !/^[A-Za-z0-9_-]{1,160}$/.test(id) || forbidden.has(id)) throw new Error('잘못된 항목 ID입니다. 백업을 확인해주세요.');
  return id;
}
function copyFields(value,skip=[]) {
  const out={};
  for(const [k,v] of Object.entries(value)) if(!forbidden.has(k) && !skip.includes(k)) out[k]=clone(v);
  return out;
}
export function flatten(state) {
  const records={};
  function put(key,data){if(records[key]) throw new Error('중복된 항목 ID입니다. 원본 백업을 보존했습니다.'); records[key]=data;}
  (state.projects||[]).forEach((p,rank)=>{
    safeId(p.id);
    put('p_'+p.id,{kind:'project',id:p.id,rank,fields:copyFields(p,['id','tasks'])});
    const walk=(nodes,parentId)=>nodes.forEach((n,rank)=>{
      safeId(n.id);
      put('t_'+n.id,{kind:'task',id:n.id,projectId:p.id,parentId,rank,fields:copyFields(n,['id','children','runningSince'])});
      walk(n.children||[],n.id);
    });
    walk(p.tasks||[],null);
  });
  (state.integrationEvents||[]).forEach(e=>{
    safeId(e.event.id);
    put('e_'+e.event.id,{kind:'event',id:e.event.id,fields:clone(e)});
  });
  return records;
}
export function materialize(records,activeProjectId) {
  const projects=new Map(), tasks=new Map(), events=[];
  const ordered=Object.values(records).filter(Boolean).sort((a,b)=>(a.rank||0)-(b.rank||0)||a.id.localeCompare(b.id));
  for(const r of ordered){
    safeId(r.id);
    if(r.kind==='project') projects.set(r.id,{...copyFields(r.fields),id:r.id,tasks:[]});
    if(r.kind==='task') tasks.set(r.id,{...copyFields(r.fields),id:r.id,children:[],runningSince:null});
    if(r.kind==='event') events.push(clone(r.fields));
  }
  const byId=new Map(ordered.filter(r=>r.kind==='task').map(r=>[r.id,r]));
  for(const r of ordered.filter(r=>r.kind==='task')){
    let p=projects.get(r.projectId);
    if(!p){
      const recoveredId='recovered_'+r.projectId;
      if(!projects.has(recoveredId))projects.set(recoveredId,{id:recoveredId,name:'복구된 할 일',tasks:[],inserts:[],isRoutine:false,routineLog:[]});
      p=projects.get(recoveredId);
    }
    let valid=!!r.parentId, cursor=r.parentId; const seen=new Set([r.id]);
    while(cursor){
      const parent=byId.get(cursor);
      if(seen.has(cursor)||!parent||parent.projectId!==r.projectId){valid=false;break;}
      seen.add(cursor);cursor=parent.parentId;
    }
    (valid?tasks.get(r.parentId).children:p.tasks).push(tasks.get(r.id));
  }
  const ps=[...projects.values()];
  return {projects:ps,activeProjectId:projects.has(activeProjectId)?activeProjectId:ps[0]?.id||null,integrationEvents:events};
}
export function mergeRecord(base,local,remote) {
  if(equal(local,base)) return {value:clone(remote),conflicts:[]};
  if(equal(remote,base)||equal(local,remote)) return {value:clone(local),conflicts:[]};
  if(!base||!local||!remote)return {value:clone(local),conflicts:['항목 삭제 또는 생성']};
  const conflicts=[];
  function merge(b,l,r,path){
    if(equal(l,b))return clone(r);
    if(equal(r,b)||equal(l,r))return clone(l);
    if(b && l && r && !Array.isArray(b) && !Array.isArray(l) && !Array.isArray(r) && typeof b==='object' && typeof l==='object' && typeof r==='object'){
      const out={};
      for(const key of new Set([...Object.keys(b),...Object.keys(l),...Object.keys(r)])){
        if(forbidden.has(key))continue;
        const v=merge(b[key],l[key],r[key],path?path+'.'+key:key);
        if(v!==undefined)out[key]=v;
      }
      return out;
    }
    conflicts.push(path);return clone(l);
  }
  return {value:merge(base,local,remote,''),conflicts};
}
export function mergeMaps(base,local,remote){
  const value={},conflicts=[];
  for(const key of new Set([...Object.keys(base),...Object.keys(local),...Object.keys(remote)])){
    if(!(key in base) && key in remote && remote[key]===null && local[key]){
      value[key]=clone(local[key]);conflicts.push({key,fields:['이미 삭제된 항목'],local:clone(local[key]),remote:null});continue;
    }
    const m=mergeRecord(base[key]||null,local[key]||null,remote[key]||null);
    if(m.value)value[key]=m.value;
    else if(key in remote && remote[key]===null)value[key]=null;
    if(m.conflicts.length)conflicts.push({key,fields:m.conflicts,local:clone(local[key]),remote:clone(remote[key])});
  }
  return {value,conflicts};
}
