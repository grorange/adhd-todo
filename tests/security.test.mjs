import {initializeTestEnvironment,assertFails,assertSucceeds} from '@firebase/rules-unit-testing';
import {doc,setDoc,getDoc,getDocs,collection,deleteDoc,serverTimestamp} from 'firebase/firestore';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const env=await initializeTestEnvironment({projectId:'demo-jjogaera',firestore:{host:'127.0.0.1',port:8180,rules:readFileSync(new URL('../firestore.rules',import.meta.url),'utf8')}});
try{
 await env.clearFirestore();
 const claims={email_verified:true,firebase:{sign_in_provider:'google.com'}};
 const owner=env.authenticatedContext('alice',claims).firestore();
 const other=env.authenticatedContext('bob',claims).firestore();
 const anon=env.authenticatedContext('alice',{firebase:{sign_in_provider:'anonymous'}}).firestore();
 const guest=env.unauthenticatedContext().firestore();
 const unverified=env.authenticatedContext('alice',{email_verified:false,firebase:{sign_in_provider:'google.com'}}).firestore();
 const path='users/alice/todo/p_test';
 const value={schema:1,data:{kind:'project',id:'test',rank:0,fields:{name:'test'}},revision:1,previous:[],updatedAt:serverTimestamp()};
 await assertSucceeds(setDoc(doc(owner,path),value));
 await assertSucceeds(getDoc(doc(owner,path)));
 await assertSucceeds(getDocs(collection(owner,'users/alice/todo')));
 for(const db of [other,anon,guest,unverified]){
  await assertFails(getDoc(doc(db,path)));
  await assertFails(setDoc(doc(db,path),value));
  await assertFails(getDocs(collection(db,'users/alice/todo')));
 }
 await assertFails(setDoc(doc(owner,path),{...value,admin:true}));
 await assertFails(setDoc(doc(owner,path),{...value,updatedAt:new Date(0)}));
 await assertFails(setDoc(doc(owner,'accounts/alice/linkedUids/bob'),{allowed:true}));
 await assertFails(setDoc(doc(owner,'pairing_codes/code'),{accountId:'alice'}));
 await assertFails(deleteDoc(doc(owner,path)));
 await assertFails(setDoc(doc(owner,path),{...value,data:null,revision:2,previous:[]}));
 await assertSucceeds(setDoc(doc(owner,path),{...value,data:null,revision:2,previous:[{revision:1,data:value.data}]}));
 assert.equal((await getDoc(doc(owner,path))).data().data,null);
 console.log('PASS: owner access, cross-account isolation, anonymous/signed-out rejection, schema, legacy paths, tombstones');
}finally{await env.cleanup();}
