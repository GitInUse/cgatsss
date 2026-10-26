import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,existsSync,mkdirSync,unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import sharp from 'sharp';
import {createApp,openDatabase} from '../server.js';
import {restore} from '../scripts/restore.js';
import {fullBackup} from '../scripts/full-backup.js';
import {restoreFull} from '../scripts/restore-full.js';
import {request} from './transport.js';

async function setup(t){
 const dir=mkdtempSync(path.join(tmpdir(),'party-moderation-')),origin='http://party.test';
 let clock=Date.parse('2026-10-31T23:00Z');
 const options={dataDir:path.join(dir,'data'),localPreview:true,testing:true,production:false,now:()=>clock};
 let app=createApp(options);t.after(()=>{app.locals.db.close();rmSync(dir,{recursive:true,force:true});});
 async function client(host=false){
  const cookies=new Map();let csrf;
  const call=async(url,body,method=body?'POST':'GET')=>{
   const headers={Cookie:[...cookies].map(([k,v])=>`${k}=${v}`).join('; ')};
   if(method!=='GET'){headers.Origin=origin;headers['X-CSRF-Token']=csrf;}
   if(body&&!(body instanceof FormData)){headers['Content-Type']='application/json';body=JSON.stringify(body);}
   const res=await request(app,origin+url,{method,headers,body});
   for(const c of res.headers.getSetCookie()){const[k,v]=c.split(';')[0].split('=');cookies.set(k,v);}
   const raw=Buffer.from(await res.arrayBuffer()),data=res.headers.get('content-type')?.includes('application/json')?JSON.parse(raw):raw;
   if(data.csrf)csrf=data.csrf;return{status:res.status,data,headers:res.headers};
  };
  await call('/api/state');if(host)assert.equal((await call('/api/login',{password:'1031'})).status,200);return call;
 }
 const host=await client(true),owner=await client(),other=await client();
 const settings={timezone:'America/Chicago',start:'2026-10-31T17:00',entriesClose:'2026-10-31T20:00',end:'2026-10-31T21:00',categories:['Best'],submissionMode:'guest'};
 const c=await host('/api/host/contests',{title:'Moderation party',settings,requestId:'moderation-test'});assert.equal(c.status,201);
 const jpeg=await sharp({create:{width:12,height:12,channels:3,background:'#ff8800'}}).jpeg().toBuffer();
 const form=(revision)=>{const f=new FormData();f.append('name','Costume');f.append('category','Best');if(revision!==undefined)f.append('revision',String(revision));f.append('photo',new Blob([jpeg],{type:'image/jpeg'}),'costume.jpg');return f;};
 const row=id=>app.locals.db.prepare('SELECT * FROM entries WHERE id=?').get(id);
 const mod=(id,action,revision=row(id).revision,confirm=true)=>host(`/api/host/entries/${id}/moderation`,{action,revision,confirm});
 return{dir,options,host,owner,other,settings,contestId:c.data.id,client,form,row,mod,get app(){return app;},setClock:v=>{clock=Date.parse(v);},restart:()=>{app.locals.db.close();app=createApp(options);}};
}

test('pending photos are private; approval, hide/restore and host auto-approval are enforced',async t=>{
 const f=await setup(t),{host,owner,other,form,mod,row}=f;
 const submitted=await owner('/api/entries',form());assert.equal(submitted.status,201);assert.equal(submitted.data.status,'pending');const id=submitted.data.id;
 assert.equal((await other('/api/state')).data.entries.length,0);
 assert.equal((await other(`/api/photos/${id}`)).status,404);
 assert.equal((await owner(submitted.data.photoUrl)).status,404,'Owner must use the explicitly private photo endpoint');
 const mine=(await owner('/api/my-entries')).data[0];assert.equal(mine.status,'pending');assert.equal((await owner(mine.photoUrl)).status,200);assert.equal((await other(mine.photoUrl)).status,404);
 assert.equal((await other('/api/my-entries')).data.length,0);
 assert.equal((await other('/api/votes',{entryId:id})).status,404);
 assert.equal((await other(`/api/host/entries/${id}/moderation`,{action:'approve',revision:0})).status,401);
 assert.equal((await mod(id,'approve',null)).status,409);
 assert.equal((await mod(id,'approve')).status,200);
 assert.equal((await mod(id,'hide',0)).status,409,'Stale approval card cannot change the entry');
 assert.equal((await other('/api/state')).data.entries.length,1);assert.equal((await other(submitted.data.photoUrl)).status,200);
 assert.equal((await mod(id,'hide')).status,200);assert.equal((await other(submitted.data.photoUrl)).status,404);assert.equal((await other('/api/votes',{entryId:id})).status,404);
 assert.equal((await mod(id,'restore')).status,200);assert.equal((await other('/api/votes',{entryId:id})).status,201);
 const hostEntry=await host('/api/entries',form());assert.equal(hostEntry.data.status,'approved');assert.equal(row(hostEntry.data.id).approval,'approved');
 const pending=await owner('/api/entries',form());await mod(pending.data.id,'hide');await mod(pending.data.id,'restore');assert.equal(row(pending.data.id).approval,'pending','Restore does not silently approve');
});

test('photo deletion and approved replacement retain entry identity and votes; stale URLs never serve replacements',async t=>{
 const f=await setup(t),{host,owner,other,form,mod,row}=f;
 const e=(await owner('/api/entries',form())).data,id=e.id;await mod(id,'approve');await other('/api/votes',{entryId:id});
 const photo=row(id).photo;
 assert.equal((await mod(id,'delete_photo',row(id).revision,false)).status,400);assert.ok(existsSync(path.join(f.options.dataDir,'photos',photo)));
 assert.equal((await mod(id,'delete_photo')).status,200);assert.equal(row(id).photo,'');assert.equal(row(id).approval,'needs_replacement');assert.equal(existsSync(path.join(f.options.dataDir,'photos',photo)),false);
 assert.equal((await other(e.photoUrl)).status,404);assert.equal((await host(`/api/photos/${id}`)).status,404);
 f.setClock('2026-11-01T01:30Z'); // Entries closed, voting still open.
 assert.equal((await other(`/api/entries/${id}/replacement`,form(row(id).revision))).status,404);
 const r=await owner(`/api/entries/${id}/replacement`,form(row(id).revision));assert.equal(r.status,200);assert.equal(r.data.status,'pending');
 assert.notEqual(row(id).photo,photo);assert.equal(row(id).id,id);assert.equal((await other(e.photoUrl)).status,404);assert.equal((await other(`/api/photos/${id}`)).status,404);
 assert.equal((await other('/api/state')).data.entries.length,0);await mod(id,'approve');
 const visible=(await other('/api/state')).data.entries[0];assert.equal(visible.id,id);assert.equal((await other(visible.photoUrl)).status,200);
 const votes=f.app.locals.db.prepare('SELECT * FROM votes').all();assert.equal(votes.length,1);assert.equal(votes[0].entry_id,id);
 assert.equal((await other('/api/votes',{entryId:id})).status,409,'Replacement never resets the recorded ballot');
 await mod(id,'delete_photo');f.setClock('2026-11-01T02:00Z');
 assert.equal((await owner(`/api/entries/${id}/replacement`,form(row(id).revision))).status,403);
 assert.equal((await host(`/api/entries/${id}/replacement`,form(row(id).revision))).status,200);assert.equal(row(id).approval,'approved');
});

test('withdrawal, publication and changed schedules preserve ballots and enforce winner privacy',async t=>{
 const f=await setup(t),{host,owner,other,form,mod,row}=f;
 const id=(await owner('/api/entries',form())).data.id;await mod(id,'approve');await other('/api/votes',{entryId:id});
 f.setClock('2026-11-01T02:00Z');
 assert.equal((await host('/api/host/winners',{contestId:f.contestId,category:'Best',entryId:id},'PUT')).status,200);
 const url=(await other('/api/state')).data.winners[0].photoUrl;assert.equal((await other(url)).status,200);
 assert.equal((await mod(id,'delete_photo')).status,409);assert.equal((await owner(`/api/entries/${id}/withdraw`,{revision:row(id).revision,confirm:true})).status,409);
 await host('/api/host/winners',{contestId:f.contestId,category:'Best',entryId:null},'PUT');
 assert.equal((await other(`/api/entries/${id}/withdraw`,{revision:row(id).revision,confirm:true})).status,404);
 assert.equal((await owner(`/api/entries/${id}/withdraw`,{revision:row(id).revision,confirm:false})).status,400);
 assert.equal((await owner(`/api/entries/${id}/withdraw`,{revision:row(id).revision,confirm:true})).status,200);
 assert.equal((await mod(id,'restore')).status,409);assert.equal((await host('/api/host/winners',{contestId:f.contestId,category:'Best',entryId:id},'PUT')).status,400);
 assert.equal((await other(url)).status,404);assert.equal((await owner(`/api/my-entries/${id}/photo/${row(id).photo}`)).status,404);
 await host('/api/host/contests/'+f.contestId,{title:'Moderation party',settings:{...f.settings,start:'2026-10-31T17:00',entriesClose:'2026-11-01T20:00',end:'2026-11-01T21:00'}},'PUT');
 assert.equal(f.app.locals.db.prepare('SELECT COUNT(*) n FROM votes').get().n,1);assert.equal((await other('/api/votes',{entryId:id})).status,404);
 const pending=(await owner('/api/entries',form())).data.id;await host('/api/host/contests/'+f.contestId,{title:'Moderation party',settings:{...f.settings,override:'closed'}},'PUT');
 assert.equal((await host('/api/host/winners',{contestId:f.contestId,category:'Best',entryId:pending},'PUT')).status,400);
});

test('simultaneous replacement requests, cutoff during conversion and revoked host sessions cannot overwrite photo state',async t=>{
 const f=await setup(t),{host,owner,form,mod,row}=f;
 const id=(await owner('/api/entries',form())).data.id;await mod(id,'delete_photo');
 const revision=row(id).revision;
 const results=await Promise.all([owner(`/api/entries/${id}/replacement`,form(revision)),owner(`/api/entries/${id}/replacement`,form(revision))]);
 assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
 await mod(id,'delete_photo');
 const original=sharp.prototype.toBuffer;let callback;
 sharp.prototype.toBuffer=async function(...args){const result=await original.apply(this,args);if(callback){const fn=callback;callback=null;fn();}return result;};
 t.after(()=>{sharp.prototype.toBuffer=original;});
 callback=()=>f.setClock('2026-11-01T02:00Z');
 assert.equal((await owner(`/api/entries/${id}/replacement`,form(row(id).revision))).status,403);assert.equal(row(id).photo,'');
 callback=()=>f.app.locals.db.prepare('DELETE FROM sessions').run();
 assert.equal((await host(`/api/entries/${id}/replacement`,form(row(id).revision))).status,401);assert.equal(row(id).photo,'');
});

test('version 2 export/full backup restore deleted photos and moderation states and survive restarts',async t=>{
 const f=await setup(t),{host,owner,other,form,mod,row}=f;
 const removed=(await owner('/api/entries',form())).data.id;await mod(removed,'approve');await other('/api/votes',{entryId:removed});await mod(removed,'delete_photo');
 const pending=(await owner('/api/entries',form())).data.id;
 const backup=await host('/api/host/export');assert.equal(backup.status,200);const zip=path.join(f.dir,'export.zip');writeFileSync(zip,backup.data);
 const dest=path.join(f.dir,'restored');await restore(zip,dest);let db=openDatabase(dest);
 assert.equal(db.prepare('SELECT approval FROM entries WHERE id=?').get(removed).approval,'needs_replacement');assert.equal(db.prepare('SELECT photo FROM entries WHERE id=?').get(removed).photo,'');assert.equal(db.prepare('SELECT approval FROM entries WHERE id=?').get(pending).approval,'pending');assert.equal(db.prepare('SELECT COUNT(*) n FROM votes').get().n,1);db.close();
 const full=path.join(f.dir,'full.zip');assert.equal((await fullBackup(f.options.dataDir,full)).photos,1);assert.equal((await restoreFull(full,path.join(f.dir,'full-restored'))).photos,1);
 f.restart();assert.equal(row(removed).approval,'needs_replacement');assert.equal((await owner('/api/my-entries')).data.length,2);assert.equal((await other('/api/state')).data.entries.length,0);
});

test('additive migration keeps legacy entries/hidden flags/votes and is idempotent',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'legacy-moderation-'));let db;
 try{
  mkdirSync(path.join(dir,'photos'));db=new DatabaseSync(path.join(dir,'party.sqlite'));
  db.exec("CREATE TABLE entries(id TEXT PRIMARY KEY, contest_id TEXT, name TEXT, category TEXT, caption TEXT, photo TEXT NOT NULL, owner TEXT, hidden INTEGER DEFAULT 0, created TEXT); INSERT INTO entries VALUES ('visible','old','Guest','Best','','legacy.jpg','owner',0,'old'),('hidden','old','Private','Best','','hidden.jpg','owner',1,'old')");db.close();db=openDatabase(dir);
  const rows=db.prepare('SELECT * FROM entries ORDER BY id').all();assert.equal(rows.length,2);assert.ok(rows.every(e=>e.approval==='approved'&&e.revision===0));assert.equal(rows[0].hidden,1);assert.equal(rows[1].hidden,0);db.close();db=openDatabase(dir);assert.equal(db.prepare('SELECT COUNT(*) n FROM entries').get().n,2);
 }finally{db?.close();rmSync(dir,{recursive:true,force:true});}
});


test('missing files cannot receive votes and interrupted physical deletion resumes at startup',async t=>{
 const f=await setup(t),{host,other,form,row}=f;
 const id=(await host('/api/entries',form())).data.id,file=row(id).photo;
 unlinkSync(path.join(f.options.dataDir,'photos',file));
 assert.equal((await other('/api/state')).data.entries.length,0);
 assert.equal((await other('/api/votes',{entryId:id})).status,404);
 const orphan='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.jpg';writeFileSync(path.join(f.options.dataDir,'photos',orphan),'generated orphan');
 f.app.locals.db.prepare('INSERT INTO photo_deletions VALUES (?)').run(orphan);
 f.restart();assert.equal(existsSync(path.join(f.options.dataDir,'photos',orphan)),false);assert.equal(f.app.locals.db.prepare('SELECT COUNT(*) n FROM photo_deletions').get().n,0);
});


test('owners do not gain private archive access when a new party starts',async t=>{
 const f=await setup(t),{host,owner,form}=f;
 const id=(await owner('/api/entries',form())).data.id;
 const privateUrl=(await owner('/api/my-entries')).data[0].photoUrl;
 assert.equal((await owner(privateUrl)).status,200);
 f.setClock('2026-11-01T02:00Z');
 const next=await host('/api/host/contests',{title:'Next party',expectedCurrentId:f.contestId,requestId:'next-moderation-party',settings:{...f.settings,start:'2027-10-31T17:00',entriesClose:'2027-10-31T20:00',end:'2027-10-31T21:00'}});
 assert.equal(next.status,201);assert.equal((await owner('/api/my-entries')).data.length,0);
 assert.equal((await owner(privateUrl)).status,404);
 assert.equal((await owner(`/api/entries/${id}/withdraw`,{revision:0,confirm:true})).status,404);
 assert.equal((await host(`/api/host/contests/${f.contestId}/archive`)).data.entries.length,1);
});
