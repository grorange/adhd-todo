import {equal,mergeMaps,mergeRecord} from './sync-core.mjs';

export class SyncSession {
  constructor({adapter,local,base={},apply,persist,status}) {
    Object.assign(this,{adapter,local,base,apply,persist,status});
    this.remote=null;this.busy=false;this.stopped=false;this.conflicts=[];
  }
  changed(local){this.local=local;this.persist(this.base,this.local);this.schedule();}
  receive(remote){this.remote=remote;this.schedule();}
  schedule(){if(this.stopped)return;clearTimeout(this.timer);this.timer=setTimeout(()=>this.sync(),600);}
  stop(){this.stopped=true;clearTimeout(this.timer);}
  async sync(){
    if(this.stopped||this.busy||!this.remote)return;
    this.busy=true;
    try{
      const merged=mergeMaps(this.base,this.local,this.remote);
      if(merged.conflicts.length){this.conflicts=merged.conflicts;this.status('conflict',merged.conflicts);return;}
      this.base=this.remote;this.local=merged.value;
      this.persist(this.base,this.local);this.apply(this.local);
      const keys=[...new Set([...Object.keys(this.base),...Object.keys(this.local)])].filter(k=>!equal(this.base[k]||null,this.local[k]||null));
      if(!keys.length){this.status('synced');return;}
      if(new TextEncoder().encode(JSON.stringify(keys.map(k=>this.local[k]||null))).length>8*1024*1024)throw new Error('한 번의 변경 용량이 너무 큽니다. 로컬 데이터는 보존됩니다.');
      const captured=structuredClone(this.local),base=structuredClone(this.base);
      this.status('saving');
      const committed=await this.adapter.commit(keys,base,captured);
      if(this.stopped)return;
      // Edits made while a network request was pending are merged after it returns.
      const full={...base};
      for(const key of keys)full[key]=committed[key]||null;
      const later=mergeMaps(captured,this.local,full);
      if(later.conflicts.length){this.conflicts=later.conflicts;this.remote=full;this.status('conflict',later.conflicts);return;}
      this.base=full;this.local=later.value;this.remote=full;
      this.persist(this.base,this.local);this.apply(this.local);this.status('synced');
      // The live listener maintains changed documents; do not download the whole list after every edit.
      this.remote=this.adapter.latest?this.adapter.latest():await this.adapter.read();
      if(!equal(this.local,this.remote))this.schedule();
    }catch(e){
      if(e.conflicts){this.conflicts=e.conflicts;this.status('conflict',e.conflicts);}
      else {this.status('error',e);if(!this.stopped)this.timer=setTimeout(()=>this.sync(),15000);}
    }finally{this.busy=false;}
  }
  async resolve(choice){
    const remote=await this.adapter.read();
    const merged=mergeMaps(this.base,this.local,remote);
    for(const c of merged.conflicts){
      const selected=choice==='local'?this.local[c.key]:remote[c.key];
      if(selected)merged.value[c.key]=selected;else delete merged.value[c.key];
    }
    this.base=remote;this.remote=remote;this.local=merged.value;this.conflicts=[];
    this.persist(this.base,this.local);this.apply(this.local);this.schedule();
  }
}

export function mergeTransaction(keys,base,local,remote){
  const result={},conflicts=[];
  for(const key of keys){
    if(!(key in base)&&key in remote&&remote[key]===null&&local[key]){
      conflicts.push({key,fields:['이미 삭제된 항목'],local:local[key],remote:null});continue;
    }
    const m=mergeRecord(base[key]||null,local[key]||null,remote[key]||null);
    result[key]=m.value;
    if(m.conflicts.length)conflicts.push({key,fields:m.conflicts,local:local[key],remote:remote[key]});
  }
  if(conflicts.length){const e=new Error('동시 수정 충돌');e.conflicts=conflicts;throw e;}
  return result;
}
