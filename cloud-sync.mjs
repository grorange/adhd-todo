import {initializeApp} from 'firebase/app';
import {getAuth,GoogleAuthProvider,signInWithPopup,signInWithCredential,onAuthStateChanged,signOut} from 'firebase/auth';
import {getFirestore,collection,doc,onSnapshot,getDocsFromServer,runTransaction,serverTimestamp,query,where,Timestamp} from 'firebase/firestore';
import {flatten,materialize,equal} from './sync-core.mjs';
import {SyncSession,mergeTransaction} from './sync-session.mjs';

const config={apiKey:'AIzaSyDlJDIpV-qrerpEfvtRKl8StS6cIIYi8SU',authDomain:'selftalkie-fd7e7.firebaseapp.com',projectId:'selftalkie-fd7e7',appId:'1:937750513581:web:f55f347272e44f694bc324'};
const app=initializeApp(config),auth=getAuth(app),db=getFirestore(app);
export {auth,db};
const ui=document.getElementById('cloudSync');
const label=ui.querySelector('[data-cloud-status]'),login=ui.querySelector('[data-cloud-login]'),logout=ui.querySelector('[data-cloud-logout]'),resolve=ui.querySelector('[data-cloud-conflict]'),historyButton=ui.querySelector('[data-cloud-history]');
let session=null,unlisten=null,generation=0,applying=false;
let historyRecords=new Map();
let refreshHistory=null;
let displayOwner=window.jjogaera.getState().cloudOwner||null;
const desktopState=new URLSearchParams(location.hash.slice(1)).get('desktop-login');
const embedded=new URLSearchParams(location.search).get('embedded')==='1' && window.parent!==window;
if(desktopState){
  history.replaceState(null,'',location.pathname);
  document.getElementById('workspace').style.display='none';
  document.querySelector('.topbar').style.display='none';
  label.textContent='SelfTalkie에 연결할 Google 계정으로 로그인해주세요.';
  login.textContent='Google 로그인 · SelfTalkie 연결';
}
const storageKey=uid=>'jjogaera_cloud_v1_'+uid;
function status(kind,detail){
  resolve.hidden=kind!=='conflict';
  const messages={synced:'동기화 완료',saving:'저장 중…',conflict:'동시 수정이 있어 확인이 필요합니다',offline:'오프라인 · 이 기기에 저장 중'};
  label.textContent=messages[kind]||('동기화 보류 · '+(detail?.code==='permission-denied'?'접근 권한을 확인해주세요.':detail?.message||'연결을 확인해주세요.'));
}
function downloadBackup(name,data){
  const a=document.createElement('a');const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
  a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
login.onclick=async()=>{
  try{
    if(embedded){
      label.textContent='브라우저에서 Google 로그인을 완료해주세요.';
      const requestId=crypto.randomUUID();
      const credential=await new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>{window.removeEventListener('message',receive);reject(new Error('로그인 시간이 지났습니다.'));},185000);
        function receive(e){
          if(e.source!==window.parent||!(e.origin==='null'||/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(e.origin))||e.data?.type!=='jjogaera-login-response'||e.data.requestId!==requestId)return;
          clearTimeout(timer);window.removeEventListener('message',receive);
          e.data.error?reject(new Error(e.data.error)):resolve(e.data.credential);
        }
        window.addEventListener('message',receive);
        window.parent.postMessage({type:'jjogaera-login-request',requestId},'*');
      });
      await signInWithCredential(auth,GoogleAuthProvider.credential(credential));
    }else{
      const result=await signInWithPopup(auth,new GoogleAuthProvider());
      if(desktopState){
        const credential=GoogleAuthProvider.credentialFromResult(result)?.idToken;
        if(!credential)throw new Error('Google 로그인 응답을 받지 못했습니다.');
        const response=await fetch('http://127.0.0.1:43129/auth/callback',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({state:desktopState,credential}),signal:AbortSignal.timeout(10000)});
        if(!response.ok)throw new Error('SelfTalkie 연결이 만료되었습니다. 앱에서 로그인을 다시 눌러주세요.');
        label.textContent='SelfTalkie에 로그인했습니다. 이 창을 닫고 앱으로 돌아가세요.';login.hidden=true;
      }
    }
  }catch(e){status('error',e);}
};
logout.onclick=async()=>{if(session){session.changed(flatten(window.jjogaera.getState()));await session.sync();}await signOut(auth);};
resolve.onclick=()=>{
  const dialog=document.getElementById('cloudConflict');dialog.showModal();
  dialog.querySelector('[data-conflict-count]').textContent=(session?.conflicts.length||0)+'개 항목을 두 기기에서 다르게 수정했습니다. 선택 전 양쪽 내용을 백업할 수 있습니다.';
};
document.querySelector('[data-conflict-backup]').onclick=()=>downloadBackup('jjogaera-conflict-backup.json',{local:session?.local,remote:session?.remote,conflicts:session?.conflicts});
for(const b of document.querySelectorAll('[data-conflict-choice]'))b.onclick=async()=>{
  if(!session)return;
  localStorage.setItem('jjogaera_conflict_backup_'+Date.now(),JSON.stringify({local:session.local,remote:session.remote}));
  try{await session.resolve(b.dataset.conflictChoice);document.getElementById('cloudConflict').close();}catch(e){status('error',e);}
};
document.querySelector('[data-conflict-close]').onclick=()=>document.getElementById('cloudConflict').close();
historyButton.onclick=async()=>{
  try{await refreshHistory?.();}catch(e){status('error',e);return;}
  const dialog=document.getElementById('cloudHistory'),list=dialog.querySelector('[data-history-list]');list.replaceChildren();
  const items=[...historyRecords.entries()].filter(([,v])=>v.previous?.length).sort((a,b)=>(b[1].updatedAt?.seconds||0)-(a[1].updatedAt?.seconds||0));
  for(const [key,v] of items){
    const title=document.createElement('strong');title.textContent=(v.data?.fields?.text||v.data?.fields?.name||v.previous.find(p=>p.data)?.data?.fields?.text||key)+(v.data?'':' · 삭제됨');
    const row=document.createElement('div');row.style.cssText='padding:12px 0;border-bottom:1px solid #e1e6f0';row.append(title);
    for(const prev of v.previous){
      if(!prev.data)continue;
      const button=document.createElement('button');button.className='btn btn-neutral';button.style.cssText='display:block;margin-top:6px;max-width:100%;white-space:normal;text-align:left';
      button.textContent='버전 '+prev.revision+' 복구 · '+(prev.data.fields?.text||prev.data.fields?.name||prev.data.kind);
      button.onclick=()=>{
        if(!confirm('이 항목을 선택한 이전 버전으로 복구할까요? 현재 버전도 복구 기록에 남습니다.'))return;
        const records=flatten(window.jjogaera.getState());records[key]=prev.data;
        window.jjogaera.applyState(materialize(records,window.jjogaera.getState().activeProjectId));dialog.close();
      };
      row.append(button);
    }
    list.append(row);
  }
  if(!items.length)list.textContent='아직 이전 버전이 없습니다. 수정·삭제하면 항목마다 최근 3개 버전을 보관합니다.';
  dialog.showModal();
};
document.querySelector('[data-history-close]').onclick=()=>document.getElementById('cloudHistory').close();
window.addEventListener('jjogaera-change',()=>{
  if(applying)return;
  try{
    const local=flatten(window.jjogaera.getState());
    if(session)session.changed(local);
    else if(displayOwner){
      const key=storageKey(displayOwner),saved=JSON.parse(localStorage.getItem(key)||'null');
      if(saved)localStorage.setItem(key,JSON.stringify({...saved,local}));
    }
  }catch(e){status('error',e);}
});
window.addEventListener('offline',()=>status('offline'));
window.addEventListener('online',()=>session?.schedule());
onAuthStateChanged(auth,async user=>{
  if(desktopState)return;
  const gen=++generation;session?.stop();session=null;unlisten?.();unlisten=null;
  login.hidden=!!user;logout.hidden=!user;historyButton.hidden=!user;resolve.hidden=true;historyRecords=new Map();refreshHistory=null;
  if(!user){label.textContent='이 기기에 저장 중 · Google 로그인으로 동기화';return;}
  if(!user.providerData.some(p=>p.providerId==='google.com')){await signOut(auth);return;}
  label.textContent='계정 데이터 연결 중…';
  try{
    const uid=user.uid,key=storageKey(uid),stored=JSON.parse(localStorage.getItem(key)||'null');
    const owner=displayOwner;
    const current=window.jjogaera.getState();
    if(owner && owner!==uid){
      const oldKey=storageKey(owner),old=JSON.parse(localStorage.getItem(oldKey)||'null');
      if(old)localStorage.setItem(oldKey,JSON.stringify({...old,local:flatten(current)}));
    }
    let local;
    if(stored)local=owner===uid?flatten(current):stored.local;
    else if(!owner && current.projects.length){
      if(!confirm('현재 이 브라우저의 할 일을 '+user.email+' 계정에 연결할까요? 기존 데이터는 이 기기에 자동 백업됩니다.')){await signOut(auth);return;}
      localStorage.setItem('jjogaera_before_cloud',JSON.stringify(current));local=flatten(current);
    }else local={};
    localStorage.setItem('jjogaera_cloud_owner',uid);
    displayOwner=uid;
    const ref=collection(db,'users',uid,'todo');
    const remoteCache=structuredClone(stored?.base||{}),revisions=new Map();
    let cursor=stored?.cursor||null,safeCursor=cursor;
    function ingest(id,value){
      if(value.schema!==1||(revisions.get(id)||0)>value.revision)return;
      revisions.set(id,value.revision);remoteCache[id]=value.data;historyRecords.set(id,value);
      const at=value.updatedAt;
      if(at && Number.isInteger(at.seconds) && (!cursor || at.seconds>cursor.seconds || (at.seconds===cursor.seconds && at.nanoseconds>cursor.nanoseconds)))cursor={seconds:at.seconds,nanoseconds:at.nanoseconds};
    }
    const adapter={
      read:async()=>{const snap=await getDocsFromServer(ref);snap.forEach(d=>ingest(d.id,d.data()));return structuredClone(remoteCache);},
      latest:()=>structuredClone(remoteCache),
      commit:async(keys,base,desired)=>runTransaction(db,async tx=>{
        const refs=keys.map(k=>doc(ref,k));const snaps=await Promise.all(refs.map(r=>tx.get(r)));
        const remote={};snaps.forEach((s,i)=>{if(s.exists())remote[keys[i]]=s.data().data;});
        const result=mergeTransaction(keys,base,desired,remote);
        const values={};
        refs.forEach((r,i)=>{
          const old=snaps[i].data();
          const previous=old?[{revision:old.revision,data:old.data},...(old.previous||[])].slice(0,3):[];
          values[keys[i]]={schema:1,data:result[keys[i]]||null,revision:(old?.revision||0)+1,previous,updatedAt:serverTimestamp()};
          tx.set(r,values[keys[i]]);
        });
        return {result,values};
      }).then(({result,values})=>{for(const [id,v] of Object.entries(values))ingest(id,v);return result;})
    };
    refreshHistory=async()=>{const snap=await getDocsFromServer(ref);if(gen!==generation)return;snap.forEach(d=>historyRecords.set(d.id,d.data()));};
    const persist=(base,local)=>{
      if(equal(base,remoteCache))safeCursor=cursor;
      localStorage.setItem(key,JSON.stringify({base,local,cursor:safeCursor}));
    };
    const apply=records=>{
      if(gen!==generation)return;
      if(equal(flatten(window.jjogaera.getState()),records)&&window.jjogaera.getState().cloudOwner===uid)return;
      applying=true;
      try{window.jjogaera.applyState({...materialize(records,window.jjogaera.getState().activeProjectId),cloudOwner:uid});}finally{applying=false;}
    };
    session=new SyncSession({adapter,local,base:stored?.base||{},apply,persist,status});
    persist(session.base,session.local);apply(local);
    const changes=stored?.cursor?query(ref,where('updatedAt','>=',new Timestamp(stored.cursor.seconds,stored.cursor.nanoseconds))):ref;
    unlisten=onSnapshot(changes,{includeMetadataChanges:true},snap=>{
      if(gen!==generation||snap.metadata.hasPendingWrites)return;
      for(const change of snap.docChanges())ingest(change.doc.id,change.doc.data());
      if(snap.metadata.fromCache)return;
      session.receive(structuredClone(remoteCache));
    },e=>status('error',e));
    logout.textContent=(user.displayName||user.email||'계정')+' · 로그아웃';
  }catch(e){status('error',e);}
});
