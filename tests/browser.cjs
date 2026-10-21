const {chromium}=require('playwright');
const esbuild=require('esbuild');
const fs=require('node:fs'),http=require('node:http'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const bundle=await esbuild.build({stdin:{contents:`import {auth,db} from './cloud-sync.mjs';
 import {connectAuthEmulator,signInWithCredential,GoogleAuthProvider,signOut} from 'firebase/auth';
 import {connectFirestoreEmulator} from 'firebase/firestore';
 connectAuthEmulator(auth,'http://127.0.0.1:9199',{disableWarnings:true});connectFirestoreEmulator(db,'127.0.0.1',8180);
 window.testLogin=async sub=>{const jwt=btoa(JSON.stringify({alg:'none'}))+'.'+btoa(JSON.stringify({sub,email:sub+'@example.com',email_verified:true,aud:'demo',iss:'https://accounts.google.com',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+3600}))+'.';await signInWithCredential(auth,GoogleAuthProvider.credential(JSON.stringify({sub,email:sub+'@example.com',email_verified:true})));};
 window.testLogout=()=>signOut(auth);`,resolveDir:path.resolve(__dirname,'..'),loader:'js'},plugins:[{name:'demo-project',setup(build){build.onLoad({filter:/cloud-sync\.mjs$/},args=>({contents:fs.readFileSync(args.path,'utf8').replace("projectId:'selftalkie-fd7e7'","projectId:'demo-jjogaera'"),loader:'js'}));}}],bundle:true,format:'esm',platform:'browser',write:false});
 const server=http.createServer((req,res)=>{
  const file=req.url==='/cloud-bundle.js'?null:path.join(__dirname,'..',req.url==='/'?'index.html':req.url.split('?')[0]);
  if(file&&!fs.existsSync(file)){res.writeHead(404);res.end();return;}
  res.setHeader('Content-Type',req.url.endsWith('.js')?'text/javascript':'text/html');res.end(file?fs.readFileSync(file):bundle.outputFiles[0].text);
 }).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROME_EXECUTABLE,headless:true});
 try{
  const contexts=await Promise.all([browser.newContext(),browser.newContext()]);
  const [a,b]=await Promise.all(contexts.map(c=>c.newPage()));const errors=[];
  const sub='sync-browser-'+Date.now();
  for(const p of [a,b]){p.on('pageerror',e=>errors.push(e.message));p.on('dialog',d=>d.accept());await p.goto('http://127.0.0.1:'+server.address().port);await p.waitForFunction(()=>window.testLogin);await p.evaluate(sub=>window.testLogin(sub),sub);await p.waitForFunction(()=>document.querySelector('[data-cloud-status]').textContent==='동기화 완료');}
  await a.evaluate(()=>window.jjogaera.applyState({projects:[{id:'browser_project',name:'브라우저 테스트',tasks:[{id:'browser_task',text:'동기화 전',status:'pending',children:[],timeSpentMs:0,runningSince:null}],inserts:[],routineLog:[]}],activeProjectId:'browser_project',integrationEvents:[]}));
  await b.waitForFunction(()=>window.jjogaera.getState().projects.some(p=>p.tasks.some(t=>t.text==='동기화 전')),{},{timeout:20000});
  await b.evaluate(()=>{const s=window.jjogaera.getState();s.projects[0].tasks[0].text='다른 창에서 수정';window.jjogaera.applyState(s)});
  await a.waitForFunction(()=>window.jjogaera.getState().projects[0]?.tasks[0]?.text==='다른 창에서 수정',{},{timeout:20000});
  await contexts[0].setOffline(true);
  await a.evaluate(()=>{const s=window.jjogaera.getState();s.projects[0].tasks[0].text='오프라인 수정';window.jjogaera.applyState(s)});
  await b.evaluate(()=>{const s=window.jjogaera.getState();s.projects[0].tasks[0].status='done';window.jjogaera.applyState(s)});
  await b.waitForFunction(()=>document.querySelector('[data-cloud-status]').textContent==='동기화 완료');
  await contexts[0].setOffline(false);
  await b.waitForFunction(()=>window.jjogaera.getState().projects[0]?.tasks[0]?.text==='오프라인 수정',{},{timeout:30000});
  assert.equal(await a.evaluate(()=>window.jjogaera.getState().projects[0].tasks[0].status),'done');
  await b.locator('#viewSettingsBtn').click();
  await b.locator('[data-cloud-history]').click();
  await b.locator('#cloudHistory button').filter({hasText:'다른 창에서 수정'}).first().click();
  await a.waitForFunction(()=>window.jjogaera.getState().projects[0]?.tasks[0]?.text==='다른 창에서 수정',{},{timeout:20000});
  await b.evaluate(()=>{const s=window.jjogaera.getState();for(let i=0;i<550;i++)s.projects[0].tasks.push({id:'bulk_'+i,text:'대량 '+i,status:'pending',children:[],runningSince:null,timeSpentMs:0});window.jjogaera.applyState(s)});
  await a.waitForFunction(()=>window.jjogaera.getState().projects[0]?.tasks.length===551,{},{timeout:40000});
  await a.evaluate(()=>window.testLogout());await a.evaluate(()=>window.testLogin('separate-account-'+Date.now()));
  await a.waitForFunction(()=>document.querySelector('[data-cloud-status]').textContent==='동기화 완료');
  assert.deepEqual(await a.evaluate(()=>window.jjogaera.getState().projects.map(p=>p.name)),['기본프로젝트','루틴프로젝트']);
  await b.reload();await b.waitForFunction(()=>document.querySelector('[data-cloud-status]').textContent==='동기화 완료');
  assert.equal(await b.evaluate(()=>window.jjogaera.getState().projects[0].tasks[0].text),'다른 창에서 수정');
  await b.evaluate(()=>window.testLogout());
  await b.waitForFunction(()=>document.querySelector('[data-cloud-login]').hidden===false);
  await b.evaluate(()=>{const s=window.jjogaera.getState();s.projects[0].tasks[0].text='로그아웃 중 수정';window.jjogaera.applyState(s)});
  await b.evaluate(()=>window.testLogin('switch-account-'+Date.now()));
  await b.waitForFunction(()=>document.querySelector('[data-cloud-status]').textContent==='동기화 완료');
  assert.deepEqual(await b.evaluate(()=>window.jjogaera.getState().projects.map(p=>p.name)),['기본프로젝트','루틴프로젝트']);
  await b.evaluate(sub=>window.testLogin(sub),sub);
  await b.waitForFunction(()=>document.querySelector('[data-cloud-status]').textContent==='동기화 완료');
  assert.equal(await b.evaluate(()=>window.jjogaera.getState().projects[0].tasks[0].text),'로그아웃 중 수정');
  const shared=await contexts[1].newPage();shared.on('dialog',d=>d.accept());
  await shared.goto('http://127.0.0.1:'+server.address().port);await shared.waitForFunction(()=>document.querySelector('[data-cloud-status]').textContent==='동기화 완료');
  assert.equal(await shared.evaluate(()=>window.jjogaera.getState().projects[0].tasks[0].text),'로그아웃 중 수정');
  await shared.evaluate(()=>window.testLogin('shared-switch-'+Date.now()));
  await b.waitForFunction(()=>window.jjogaera.getState().projects.length===2 && !window.jjogaera.getState().projects.some(p=>p.id==='browser_project'));
  await shared.waitForFunction(()=>window.jjogaera.getState().projects.length===2 && !window.jjogaera.getState().projects.some(p=>p.id==='browser_project'));
  assert.deepEqual(errors,[]);console.log('PASS: two actual browser contexts, bidirectional edits, offline merge, account separation, reload persistence');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1});


