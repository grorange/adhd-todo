import test from 'node:test';
import assert from 'node:assert/strict';
import {SyncSession,mergeTransaction} from '../sync-session.mjs';
const rec=text=>({kind:'task',id:'a',fields:{text,status:'pending'}});
function fixture(base,local,server){
 let db=structuredClone(server),saved,applied,status;
 const session=new SyncSession({base,local,adapter:{read:async()=>structuredClone(db),commit:async(keys,b,l)=>{const values=mergeTransaction(keys,b,l,db);Object.assign(db,values);return values;}},persist:(b,l)=>{saved={b,l}},apply:v=>{applied=v},status:(k,d)=>{status={k,d}}});
 session.remote=structuredClone(server);return {session,get:()=>({db,saved,applied,status})};
}
test('initial upload and subsequent remote edit',async()=>{const f=fixture({},{t_a:rec('local')},{});await f.session.sync();assert.equal(f.get().db.t_a.fields.text,'local');assert.equal(f.get().status.k,'synced');f.session.stop()});
test('offline edits survive remote changes to separate fields',async()=>{const b={t_a:rec('old')},l={t_a:rec('local')},r=structuredClone(b);r.t_a.fields.status='done';const f=fixture(b,l,r);await f.session.sync();assert.equal(f.get().db.t_a.fields.text,'local');assert.equal(f.get().db.t_a.fields.status,'done');f.session.stop()});
test('conflicting edit pauses writes',async()=>{const f=fixture({t_a:rec('old')},{t_a:rec('local')},{t_a:rec('remote')});await f.session.sync();assert.equal(f.get().status.k,'conflict');assert.equal(f.get().db.t_a.fields.text,'remote');await f.session.resolve('local');await f.session.sync();assert.equal(f.get().db.t_a.fields.text,'local');f.session.stop()});
test('deleted task does not resurrect after reconnect',async()=>{const f=fixture({t_a:rec('old')},{t_a:rec('old')},{t_a:null});await f.session.sync();assert.equal(f.get().applied.t_a,null);f.session.stop()});
test('old backup cannot silently resurrect tombstone',async()=>{const f=fixture({},{t_a:rec('backup')},{t_a:null});await f.session.sync();assert.equal(f.get().status.k,'conflict');f.session.stop()});
test('transaction detects a change after snapshot was read',()=>assert.throws(()=>mergeTransaction(['t_a'],{t_a:rec('old')},{t_a:rec('local')},{t_a:rec('newer')}),/충돌/));
test('edit while upload is in flight is retained',async()=>{const f=fixture({},{t_a:rec('one')},{});const commit=f.session.adapter.commit;f.session.adapter.commit=async(...a)=>{f.session.changed({t_a:rec('two')});return commit(...a)};await f.session.sync();assert.equal(f.session.local.t_a.fields.text,'two');f.session.stop()});
