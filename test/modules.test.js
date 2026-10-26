import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createApp,eventModules} from '../server.js';
import {request} from './transport.js';

test('module settings default safely, validate on server, preserve omitted settings and survive restart',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'party-modules-')),origin='http://party.test';
 const options={dataDir:dir,localPreview:true,production:false,testing:true};let app=createApp(options);
 const cookies=new Map();let csrf;
 async function call(route,body,method=body?'POST':'GET'){
  const headers={Cookie:[...cookies].map(([k,v])=>`${k}=${v}`).join('; ')};
  if(body){headers.Origin=origin;headers['Content-Type']='application/json';headers['X-CSRF-Token']=csrf;}
  const res=await request(app,origin+route,{method,headers,body:body?JSON.stringify(body):undefined});
  for(const c of res.headers.getSetCookie()){const[k,v]=c.split(';')[0].split('=');cookies.set(k,v);}
  const data=JSON.parse(Buffer.from(await res.arrayBuffer()));if(data.csrf)csrf=data.csrf;return{status:res.status,data};
 }
 const settings={timezone:'America/Chicago',start:'2027-10-31T17:00',entriesClose:'2027-10-31T20:00',end:'2027-10-31T21:00',categories:['Best'],submissionMode:'guest',tagline:'Claim the Belt!',override:'auto'};
 try{
  assert.deepEqual(eventModules(undefined),{countdowns:true,enterContest:true,voting:true});
  await call('/api/state');assert.equal((await call('/api/login',{password:'1031'})).status,200);
  const created=await call('/api/host/contests',{title:'Halloween',settings,requestId:'module-test'});assert.equal(created.status,201);const id=created.data.id;
  assert.equal((await call('/api/state')).data.contest.settings.modules.countdowns,true);
  const update=value=>call('/api/host/contests/'+id,{title:'Halloween',settings:value},'PUT');
  for(const modules of [null,[],true,{countdowns:'false'},{countdowns:0},{madeUp:true}])assert.equal((await update({...settings,modules})).status,400);
  assert.equal((await update({...settings,modules:{countdowns:false,enterContest:false,voting:false}})).status,200);
  assert.equal((await update({...settings,tagline:'Updated tagline'})).status,200);
  assert.equal((await call('/api/state')).data.contest.settings.modules.countdowns,false);
  assert.deepEqual((await call('/api/state')).data.contest.settings.modules,{countdowns:false,enterContest:false,voting:false});
  const row=app.locals.db.prepare('SELECT settings FROM contests WHERE id=?').get(id);assert.equal(JSON.parse(row.settings).modules.countdowns,false);
  app.locals.db.close();app=createApp(options);cookies.clear();await call('/api/state');
  assert.equal((await call('/api/state')).data.contest.settings.modules.countdowns,false);
  assert.equal((await update({...settings,modules:{countdowns:true}})).status,401);
  // Existing records need no migration and are not rewritten simply by reading.
  app.locals.db.prepare('UPDATE contests SET settings=? WHERE id=?').run(JSON.stringify(settings),id);
  assert.equal((await call('/api/state')).data.contest.settings.modules.countdowns,true);
  assert.equal(JSON.parse(app.locals.db.prepare('SELECT settings FROM contests WHERE id=?').get(id).settings).modules,undefined);
 }finally{app.locals.db.close();rmSync(dir,{recursive:true,force:true});}
});

test('entry and voting switches are independent, enforced for direct requests, and preserve records',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'party-switches-')),origin='http://party.test';
 const app=createApp({dataDir:dir,localPreview:true,production:false,testing:true,now:()=>Date.parse('2027-11-01T00:00:00Z')});
 async function client(host=false){const cookies=new Map();let csrf;const call=async(route,body,method=body?'POST':'GET')=>{const headers={Cookie:[...cookies].map(([k,v])=>`${k}=${v}`).join('; ')};if(body){headers.Origin=origin;headers['X-CSRF-Token']=csrf;if(!(body instanceof FormData))headers['Content-Type']='application/json';}const res=await request(app,origin+route,{method,headers,body:body?(body instanceof FormData?body:JSON.stringify(body)):undefined});for(const c of res.headers.getSetCookie()){const[k,v]=c.split(';')[0].split('=');cookies.set(k,v);}const data=JSON.parse(Buffer.from(await res.arrayBuffer()));if(data.csrf)csrf=data.csrf;return{status:res.status,data};};await call('/api/state');if(host)await call('/api/login',{password:'1031'});return call;}
 const settings={timezone:'America/Chicago',start:'2027-10-31T17:00',entriesClose:'2027-10-31T20:00',end:'2027-10-31T21:00',categories:['Best'],submissionMode:'guest'};
 try{
  const host=await client(true),created=await host('/api/host/contests',{title:'Switch test',settings,requestId:'switch-test'}),id=created.data.id;
  const sharp=(await import('sharp')).default,jpeg=await sharp({create:{width:8,height:8,channels:3,background:'#ff8800'}}).jpeg().toBuffer();
  const form=()=>{const f=new FormData();f.append('name','Ghost');f.append('category','Best');f.append('photo',new Blob([jpeg],{type:'image/jpeg'}),'ghost.jpg');return f;};
  const owner=await client(),entry=(await owner('/api/entries',form())).data.id;let votes=0;
  assert.equal((await host(`/api/host/entries/${entry}/moderation`,{action:'approve',revision:0})).status,200);
  for(const enterContest of [false,true])for(const voting of [false,true]){
   assert.equal((await host('/api/host/contests/'+id,{title:'Switch test',settings:{...settings,modules:{enterContest,voting}}},'PUT')).status,200);
   const guest=await client();assert.equal((await guest('/api/entries',form())).status,enterContest?201:403);
   assert.equal((await owner('/api/entries/'+entry,{name:'Ghost edited',caption:''},'PUT')).status,enterContest?200:403);
   assert.equal((await guest('/api/votes',{entryId:entry})).status,voting?201:403);if(voting)votes++;
   assert.equal(app.locals.db.prepare('SELECT COUNT(*) n FROM votes').get().n,votes);
   assert.equal((await guest('/api/messages',{author:'Guest',message:'Great party!'})).status,201);
   assert.ok((await guest('/api/state')).data.entries.some(e=>e.id===entry),'Existing gallery stays visible');
   assert.equal((await host('/api/entries',form())).status,201,'Host intake remains available');
   assert.equal((await host('/api/entries/'+entry,{name:'Host correction',caption:''},'PUT')).status,200);
  }
  assert.equal((await host('/api/host/contests/'+id,{title:'Switch test',settings:{...settings,modules:{voting:false}}},'PUT')).status,200);
  assert.equal((await host('/api/votes',{entryId:entry})).status,403,'Host cannot cast ballots while voting is disabled');
  assert.equal(app.locals.db.prepare('SELECT COUNT(*) n FROM votes').get().n,2);
 }finally{app.locals.db.close();rmSync(dir,{recursive:true,force:true});}
});
