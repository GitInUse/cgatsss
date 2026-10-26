import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {createApp} from '../server.js';
import {restore} from '../scripts/restore.js';
import {request} from './transport.js';

test('historical winners stay private until published, support edits and survive photo backup restore',async()=>{
 const root=mkdtempSync(path.join(tmpdir(),'party-hall-'));
 const options={dataDir:path.join(root,'data'),localPreview:true,production:false,testing:true,now:()=>Date.parse('2026-10-31T23:00Z')};
 const app=createApp(options);let restoredApp;
 async function client(target=app,host=false){
  const cookies=new Map();let csrf;
  const call=async(route,body,method=body?'POST':'GET')=>{
   const headers={Cookie:[...cookies].map(([k,v])=>`${k}=${v}`).join('; ')};
   if(body){headers.Origin='http://party.test';headers['X-CSRF-Token']=csrf;if(!(body instanceof FormData)){headers['Content-Type']='application/json';body=JSON.stringify(body);}}
   const res=await request(target,'http://party.test'+route,{method,headers,body});
   for(const c of res.headers.getSetCookie()){const[k,v]=c.split(';')[0].split('=');cookies.set(k,v);}
   const raw=Buffer.from(await res.arrayBuffer());const data=res.headers.get('content-type')?.includes('application/json')?JSON.parse(raw):raw;
   if(data.csrf)csrf=data.csrf;return{status:res.status,data};
  };
  await call('/api/state');if(host)assert.equal((await call('/api/login',{password:'1031'})).status,200);return call;
 }
 const image=await sharp({create:{width:20,height:30,channels:3,background:'#ff8800'}}).jpeg().withMetadata({orientation:6}).toBuffer();
 function form(values={},photo=image){const data=new FormData();for(const[k,v]of Object.entries({name:'Past Ghost',category:'Best Overall',title:'2025 Champion',...values}))data.append(k,v);if(photo)data.append('photo',new Blob([photo],{type:'image/jpeg'}),'winner.jpg');return data;}
 try{
  const host=await client(app,true),guest=await client();
  const settings={timezone:'America/Chicago',start:'2026-10-31T17:00',entriesClose:'2026-10-31T20:00',end:'2026-10-31T21:00',categories:['Kids','Funniest'],submissionMode:'guest',override:'auto'};
  const active=await host('/api/host/contests',{title:'Current party',settings,requestId:'hall-test-party'});assert.equal(active.status,201);
  assert.equal((await guest('/api/host/hall-of-fame')).status,401);
  assert.equal((await guest('/api/host/hall-of-fame',form())).status,401);
  assert.equal((await host('/api/host/hall-of-fame',form({},null))).status,400);
  assert.equal((await host('/api/host/hall-of-fame',form({},Buffer.from('<svg/>')))).status,400);
  const added=await host('/api/host/hall-of-fame',form());assert.equal(added.status,201);const{id,contestId}=added.data;
  assert.equal((await guest('/api/state')).data.contest.id,active.data.id);
  assert.equal((await guest(`/api/photos/${id}`)).status,404);
  assert.equal((await host('/api/host/hall-of-fame')).data[0].published,false);
  const metadata=await sharp((await host(`/api/photos/${id}`)).data).metadata();assert.equal(metadata.exif,undefined);assert.equal(metadata.orientation,undefined);
  assert.equal((await guest(`/api/host/hall-of-fame/${id}`,form({name:'Hijack'},null),'PUT')).status,401);
  assert.equal((await host(`/api/host/hall-of-fame/${id}`,form({name:'Edited Ghost',category:'Spookiest',title:'2024 Champion'},null),'PUT')).status,200);
  assert.equal((await host('/api/host/winners',{contestId,category:'Spookiest',entryId:id},'PUT')).status,200);
  assert.equal((await guest(`/api/photos/${id}`)).status,200);
  let winner=(await guest('/api/state')).data.winners.find(w=>w.id===id);assert.equal(winner.name,'Edited Ghost');assert.equal(winner.contestTitle,'2024 Champion');
  const oldFile=app.locals.db.prepare('SELECT photo FROM entries WHERE id=?').get(id).photo;
  const replacement=await sharp({create:{width:42,height:24,channels:3,background:'#ff0000'}}).png().toBuffer();
  assert.equal((await host(`/api/host/hall-of-fame/${id}`,form({name:'Champion Ghost',category:'Best Costume',title:'2023 Champion'},replacement),'PUT')).status,200);
  winner=(await guest('/api/state')).data.winners.find(w=>w.id===id);assert.equal(winner.category,'Best Costume');assert.equal(winner.contestTitle,'2023 Champion');
  assert.equal((await sharp((await guest(winner.photoUrl)).data).metadata()).width,42);
  assert.ok(readFileSync(path.join(options.dataDir,'photos',oldFile)).length>0); // Earlier database backups still reference the old immutable file.
  assert.equal(app.locals.db.prepare('SELECT COUNT(*) AS n FROM votes WHERE contest_id=?').get(contestId).n,0);
  assert.equal((await host('/api/host/winners',{contestId,category:'Best Costume',entryId:null},'PUT')).status,200);
  assert.equal((await guest(`/api/photos/${id}`)).status,404);
  assert.equal((await host('/api/host/hall-of-fame')).data[0].published,false);
  assert.equal((await host('/api/host/winners',{contestId,category:'Best Costume',entryId:id},'PUT')).status,200);
  const entryForm=new FormData();entryForm.append('name','New costume');entryForm.append('category','Funniest');entryForm.append('photo',new Blob([image],{type:'image/jpeg'}),'entry.jpg');
  const uploaded=await guest('/api/entries',entryForm);assert.equal(uploaded.status,201);const entryId=uploaded.data.id;
  assert.equal((await guest(`/api/entries/${entryId}`,{name:'New costume',caption:'',category:'Kids'},'PUT')).status,403);
  assert.equal((await host(`/api/entries/${entryId}`,{name:'New costume',caption:'',category:'Unknown'},'PUT')).status,400);
  assert.equal((await host(`/api/entries/${entryId}`,{name:'New costume',caption:'',category:'Kids'},'PUT')).status,200);
  const pendingRow=app.locals.db.prepare('SELECT revision FROM entries WHERE id=?').get(entryId);
  assert.equal((await host(`/api/host/entries/${entryId}/moderation`,{action:'approve',revision:pendingRow.revision})).status,200);
  assert.equal((await guest('/api/votes',{entryId})).status,201);
  assert.equal((await host(`/api/entries/${entryId}`,{name:'New costume',caption:'',category:'Funniest'},'PUT')).status,409);
  const unvoted=await host('/api/entries',entryForm);assert.equal(unvoted.status,201);
  assert.equal((await host('/api/host/contests/'+active.data.id,{title:'Current party',settings:{...settings,override:'closed'}},'PUT')).status,200);
  assert.equal((await host('/api/host/winners',{contestId:active.data.id,category:'Funniest',entryId:unvoted.data.id},'PUT')).status,400);
  assert.equal((await host(`/api/host/hall-of-fame/${entryId}`,form({},null),'PUT')).status,404);
  const exported=await host('/api/host/export');assert.equal(exported.status,200);const zip=path.join(root,'backup.zip');writeFileSync(zip,exported.data);
  const restoredDir=path.join(root,'restored');await restore(zip,restoredDir);restoredApp=createApp({...options,dataDir:restoredDir});
  const restoredGuest=await client(restoredApp);winner=(await restoredGuest('/api/state')).data.winners.find(w=>w.id===id);assert.equal(winner.name,'Champion Ghost');
  assert.equal((await restoredGuest(winner.photoUrl)).status,200);
 }finally{app.locals.db.close();restoredApp?.locals.db.close();rmSync(root,{recursive:true,force:true});}
});
