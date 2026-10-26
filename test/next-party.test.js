import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createApp} from '../server.js';
import {request} from './transport.js';

test('next party and Undo are atomic, private, durable and protected against stale requests',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'party-transition-'));
 const options={dataDir:dir,localPreview:true,production:false,testing:true,now:()=>Date.parse('2026-11-01T12:00:00Z')};
 let app=createApp(options);
 async function client(host=false){
  const cookies=new Map();let csrf;
  const call=async(route,body,method=body?'POST':'GET')=>{
   const headers={Cookie:[...cookies].map(([k,v])=>`${k}=${v}`).join('; ')};
   if(body){headers.Origin='http://party.test';headers['Content-Type']='application/json';headers['X-CSRF-Token']=csrf;}
   const res=await request(app,'http://party.test'+route,{method,headers,body:body?JSON.stringify(body):undefined});
   for(const c of res.headers.getSetCookie()){const[k,v]=c.split(';')[0].split('=');cookies.set(k,v);}
   const raw=Buffer.from(await res.arrayBuffer());const data=res.headers.get('content-type')?.includes('application/json')?JSON.parse(raw):raw;
   if(data.csrf)csrf=data.csrf;return{status:res.status,data};
  };
  await call('/api/state');if(host)assert.equal((await call('/api/login',{password:'1031'})).status,200);return call;
 }
 const settings={timezone:'America/Chicago',start:'2026-10-31T17:00',entriesClose:'2026-10-31T20:00',end:'2026-10-31T21:00',categories:['Best'],submissionMode:'hybrid',tagline:'Claim the Belt!',override:'auto'};
 try{
  let host=await client(true),guest=await client();
  const initial=await host('/api/host/contests',{title:'Halloween',settings,requestId:'initial'});assert.equal(initial.status,201);const oldId=initial.data.id;
  const db=app.locals.db;
  for(const id of ['winner','private']){db.prepare('INSERT INTO entries (id,contest_id,name,category,caption,photo,owner,hidden,created) VALUES (?,?,?,?,?,?,?,0,?)').run(id,oldId,id,'Best','','sample.jpg','owner','2026-10-31');}
  writeFileSync(path.join(dir,'photos','sample.jpg'),Buffer.from([255,216,255,217]));
  db.prepare('INSERT INTO votes VALUES (?,?,?,?)').run(oldId,'Best','voter','winner');
  db.prepare('INSERT INTO messages VALUES (?,?,?,?,0,?)').run('old-message',oldId,'Guest','Great party','2026-10-31');
  assert.equal((await host('/api/host/winners',{contestId:oldId,category:'Best',entryId:'winner'},'PUT')).status,200);
  const body={title:'Halloween',requestId:'next-start',expectedCurrentId:oldId,settings:{...settings,start:'2027-10-31T17:00',entriesClose:'2027-10-31T20:00',end:'2027-10-31T21:00'}};
  assert.equal((await guest('/api/host/contests',body)).status,401);
  assert.equal((await host('/api/host/contests',{...body,settings:{...body.settings,end:'bad'}})).status,400);
  assert.equal((await host('/api/state')).data.contest.id,oldId);
  db.prepare('UPDATE contests SET settings=? WHERE id=?').run(JSON.stringify({...settings,start:'2026-11-01T00:00Z',entriesClose:'2026-11-02T00:00Z',end:'2026-11-03T00:00Z'}),oldId);
  assert.equal((await host('/api/host/contests',body)).status,409);
  db.prepare('UPDATE contests SET settings=? WHERE id=?').run(JSON.stringify(settings),oldId);
  const created=await host('/api/host/contests',body);assert.equal(created.status,201);const nextId=created.data.id;
  assert.equal((await host('/api/host/contests',body)).status,409);
  assert.equal((await host('/api/host/contests',{...body,requestId:'stale-page-new-request'})).status,409);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM contests').get().n,2);
  assert.equal((await guest('/api/host/contests/'+oldId+'/archive')).status,401);
  assert.equal((await guest('/api/photos/private/sample.jpg')).status,404);
  assert.equal((await guest('/api/photos/winner/sample.jpg')).status,200);
  assert.equal((await host('/api/photos/private/sample.jpg')).status,200);
  assert.equal((await guest('/api/state')).data.nextPartyUndo,undefined);
  assert.equal((await host('/api/state')).data.nextPartyUndo.enabled,true);
  const archive=(await host('/api/host/contests/'+oldId+'/archive')).data;
  assert.equal(archive.entries.length,2);assert.equal(archive.messages.length,1);assert.equal(archive.entries.reduce((sum,e)=>sum+e.votes,0),1);
  assert.equal((await guest(`/api/host/contests/${nextId}/undo-start`,{previousId:oldId})).status,401);
  assert.equal((await host(`/api/host/contests/${nextId}/undo-start`,{previousId:'stale'})).status,409);
  app.locals.db.close();app=createApp(options);host=await client(true);guest=await client();
  assert.equal((await host('/api/state')).data.nextPartyUndo.currentId,nextId);
  assert.equal((await host(`/api/host/contests/${nextId}/undo-start`,{previousId:oldId})).status,200);
  assert.equal((await host(`/api/host/contests/${nextId}/undo-start`,{previousId:oldId})).status,409);
  app.locals.db.close();app=createApp(options);host=await client(true);guest=await client();
  const restored=(await host('/api/state')).data;
  assert.equal(restored.contest.id,oldId);assert.equal(restored.phase,'closed');assert.equal(restored.contest.settings.override,'closed');
  assert.equal(restored.nextPartyUndo,null);assert.equal(app.locals.db.prepare('SELECT archived FROM contests WHERE id=?').get(nextId).archived,1);
  assert.equal((await host('/api/host/contests',body)).status,409);
  assert.equal((await guest('/api/photos/private/sample.jpg')).status,404);assert.equal((await guest('/api/photos/winner/sample.jpg')).status,200);
  // Each activity type independently prevents Undo, including hidden entries/messages.
  for(const type of ['entries','messages','votes']){
   const next=await host('/api/host/contests',{...body,requestId:'activity-'+type});assert.equal(next.status,201);const id=next.data.id;
   if(type==='entries')app.locals.db.prepare('INSERT INTO entries (id,contest_id,name,category,caption,photo,owner,hidden,created) VALUES (?,?,?,?,?,?,?,1,?)').run('new-entry',id,'Costume','Best','','sample.jpg','owner','2027-10-31');
   if(type==='messages')app.locals.db.prepare('INSERT INTO messages VALUES (?,?,?,?,1,?)').run('new-message',id,'Guest','Hello','2027-10-31');
   if(type==='votes')app.locals.db.prepare('INSERT INTO votes VALUES (?,?,?,?)').run(id,'Best','new-voter','winner');
   assert.equal((await host('/api/state')).data.nextPartyUndo.enabled,false);
   assert.equal((await host(`/api/host/contests/${id}/undo-start`,{previousId:oldId})).status,409);
   assert.equal((await host('/api/state')).data.contest.id,id);
   // Reset only this test fixture to exercise the next independent activity guard.
   app.locals.db.prepare('UPDATE contests SET archived=1 WHERE id=?').run(id);
   app.locals.db.prepare('UPDATE contests SET archived=0 WHERE id=?').run(oldId);
  }
 }finally{app.locals.db.close();rmSync(dir,{recursive:true,force:true});}
});
