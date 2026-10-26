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
  assert.deepEqual(eventModules(undefined),{countdowns:true});
  await call('/api/state');assert.equal((await call('/api/login',{password:'1031'})).status,200);
  const created=await call('/api/host/contests',{title:'Halloween',settings,requestId:'module-test'});assert.equal(created.status,201);const id=created.data.id;
  assert.equal((await call('/api/state')).data.contest.settings.modules.countdowns,true);
  const update=value=>call('/api/host/contests/'+id,{title:'Halloween',settings:value},'PUT');
  for(const modules of [null,[],true,{countdowns:'false'},{countdowns:0},{madeUp:true}])assert.equal((await update({...settings,modules})).status,400);
  assert.equal((await update({...settings,modules:{countdowns:false}})).status,200);
  assert.equal((await update({...settings,tagline:'Updated tagline'})).status,200);
  assert.equal((await call('/api/state')).data.contest.settings.modules.countdowns,false);
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
