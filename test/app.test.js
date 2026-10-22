import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { DateTime } from 'luxon';
import { createApp, phase, openDatabase } from '../server.js';
import { restore } from '../scripts/restore.js';
import { request } from './transport.js';

test('shared voting, private archives, publication, backup recovery, and auth boundaries', async t => {
  const dir=mkdtempSync(path.join(tmpdir(),'party-test-'));
  let clock=Date.parse('2026-10-31T23:00:00Z');
  const password='test-only-not-a-real-password';
  const app=createApp({dataDir:path.join(dir,'data'),password,production:false,testing:true,now:()=>clock});
  const origin='http://party.test';
  t.after(()=>{app.locals.db.close();rmSync(dir,{recursive:true,force:true});});
  const browser=()=>({cookies:new Map(),csrf:''});
  const host=browser(),guest=browser(),other=browser();
  async function call(b,url,method='GET',body,extras={}) {
    const headers={Cookie:[...b.cookies].map(([k,v])=>`${k}=${v}`).join(';'),...extras};
    if(method!=='GET'){headers.Origin=extras.Origin||origin;headers['X-CSRF-Token']=b.csrf;}
    if(body && !(body instanceof FormData)){headers['Content-Type']='application/json';body=JSON.stringify(body);}
    const res=await request(app,origin+url,{method,headers,body});
    for(const c of res.headers.getSetCookie()){const [pair]=c.split(';');const [k,v]=pair.split('=');b.cookies.set(k,v);}
    const raw=Buffer.from(await res.arrayBuffer());
    const data=res.headers.get('content-type')?.includes('application/json')?JSON.parse(raw):raw;
    if(data.csrf)b.csrf=data.csrf;
    return {status:res.status,data,headers:res.headers};
  }
  for(const b of [host,guest,other])assert.equal((await call(b,'/api/state')).status,200);
  assert.equal((await call(guest,'/api/host/contests')).status,401);
  assert.equal((await call(host,'/api/login','POST',{password})).status,200);
  assert.equal((await call(guest,'/api/login','POST',{password:'2902'})).status,401);
  assert.equal((await call(host,'/api/logout','POST',{}, {Origin:'https://attacker.example'})).status,403);
  const settings={timezone:'America/Chicago',start:'2026-10-31T17:00',entriesClose:'2026-10-31T20:00',end:'2026-10-31T21:00',categories:['Best Overall','Funniest'],theme:'halloween',submissionMode:'guest',announcement:'Welcome!'};
  const created=await call(host,'/api/host/contests','POST',{title:'Halloween 2026',settings,requestId:'initial-party'});assert.equal(created.status,201);
  const contestId=created.data.id;
  async function entry(b,name,category='Best Overall') {
    const photo=await sharp({create:{width:20,height:30,channels:3,background:'#ff8800'}}).jpeg().withMetadata({orientation:6}).toBuffer();
    const form=new FormData();form.append('name',name);form.append('category',category);form.append('caption','A costume');form.append('photo',new Blob([photo],{type:'image/jpeg'}),'test.jpg');
    return call(b,'/api/entries','POST',form);
  }
  const one=await entry(guest,'A ghost'),two=await entry(other,'A pumpkin');assert.equal(one.status,201);assert.equal(two.status,201);
  const s=await call(other,'/api/state');assert.equal(s.data.entries.length,2);assert.ok(!JSON.stringify(s.data).includes('owner'));
  assert.equal((await call(other,`/api/entries/${one.data.id}`,'PUT',{name:'Hijack',caption:''})).status,403);
  const image=await call(guest,`/api/photos/${one.data.id}`);assert.equal(image.status,200);assert.match(image.headers.get('cache-control'),/no-store/);
  const metadata=await sharp(image.data).metadata();assert.equal(metadata.exif,undefined);assert.equal(metadata.orientation,undefined);
  assert.equal((await call(guest,`/api/photos/${one.data.id}`,'GET',undefined,{'If-Modified-Since':new Date().toUTCString()})).status,200);
  assert.equal((await call(guest,'/api/host/export')).status,401);
  const simultaneous=await Promise.all([call(guest,'/api/votes','POST',{entryId:one.data.id}),call(guest,'/api/votes','POST',{entryId:two.data.id})]);
  assert.deepEqual(simultaneous.map(r=>r.status).sort(),[201,409]);
  assert.equal((await call(other,'/api/votes','POST',{entryId:two.data.id})).status,201);
  const fake=browser();fake.cookies.set('visitor','a'.repeat(64));fake.csrf=guest.csrf;
  assert.equal((await call(fake,'/api/votes','POST',{entryId:one.data.id})).status,403);
  assert.equal((await call(guest,'/api/messages','POST',{author:'Guest',message:'<script>alert(1)</script>'})).status,201);
  assert.equal((await call(guest,'/api/messages','POST',{author:'fucccckkkk',message:'That shiiittt costume is fuckk good!'})).status,201);
  const filtered=app.locals.db.prepare("SELECT author,message FROM messages WHERE author='**'").get();
  assert.equal(filtered.message,'That ** costume is ** good!');
  app.locals.db.prepare('INSERT INTO messages VALUES (?,?,?,?,0,?)').run('legacy-swear',created.data.id,'biiitch','fucccckkkk',new Date(clock).toISOString());
  const filteredState=await call(guest,'/api/state');const legacy=filteredState.data.messages.find(m=>m.id==='legacy-swear');
  assert.equal(legacy.author,'**');assert.equal(legacy.message,'**');

  assert.equal((await call(host,'/api/host/winners','PUT',{contestId,category:'Best Overall',entryId:one.data.id})).status,409);
  clock=Date.parse('2026-11-01T01:30:00Z'); // 20:30 CDT, entries closed but voting open
  assert.equal((await entry(guest,'Late')).status,403);
  assert.equal((await call(guest,'/api/state')).data.phase,'voting_only');
  clock=Date.parse('2026-11-01T02:00:00Z'); // scheduled closing boundary
  const closed=await call(guest,'/api/state');assert.equal(closed.data.phase,'closed');assert.equal(closed.data.entries.length,0);assert.equal(closed.data.messages.length,0);
  assert.equal((await call(guest,`/api/photos/${one.data.id}`)).status,404);
  assert.equal((await call(host,`/api/photos/${one.data.id}`)).status,200);
  assert.equal((await call(guest,'/api/votes','POST',{entryId:one.data.id})).status,403);
  assert.equal((await call(host,`/api/host/contests/${contestId}/archive`)).data.entries.reduce((n,e)=>n+e.votes,0),2);
  const published=await call(host,'/api/host/winners','PUT',{contestId,category:'Best Overall',entryId:two.data.id});assert.equal(published.status,200);
  assert.equal((await call(guest,`/api/photos/${two.data.id}`)).status,200);
  assert.equal((await call(guest,`/api/photos/${one.data.id}`,'GET',undefined,{'If-None-Match':'anything'})).status,404);
  assert.equal((await call(host,'/api/host/winners','PUT',{contestId,category:'Best Overall',entryId:null})).status,200);
  assert.equal((await call(guest,`/api/photos/${two.data.id}`)).status,404);
  await call(host,'/api/host/winners','PUT',{contestId,category:'Best Overall',entryId:two.data.id});
  const exported=await call(host,'/api/host/export');assert.equal(exported.status,200);
  const file=path.join(dir,'backup.zip');writeFileSync(file,exported.data);
  const target=path.join(dir,'restored');const restored=await restore(file,target);assert.equal(restored.entries,2);
  const db=openDatabase(target);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM votes').get().n,2);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n,0);db.close();
  assert.ok(existsSync(path.join(target,'photos',`${two.data.id}.jpg`)));
  await assert.rejects(restore(file,target),/must not exist/);
  const nextSettings={...settings,start:'2027-10-31T17:00',entriesClose:'2027-10-31T20:00',end:'2027-10-31T21:00'};
  assert.equal((await call(host,'/api/host/contests','POST',{title:'Halloween 2027',settings:nextSettings,expectedCurrentId:contestId,requestId:'next-party'})).status,201);
  const next=await call(guest,'/api/state');assert.equal(next.data.entries.length,0);assert.equal(next.data.winners.length,1);assert.equal(next.data.myVotes.length,0);
  assert.equal((await call(guest,`/api/photos/${one.data.id}`)).status,404);
  assert.equal((await call(host,'/api/logout','POST',{})).status,200);assert.equal((await call(host,'/api/host/export')).status,401);
  assert.equal((await call(guest,'/data/party.sqlite')).status,404);assert.equal((await call(guest,'/server.js')).status,404);
  const page=readFileSync(new URL('../public/party/index.html',import.meta.url),'utf8');
  assert.ok(page.includes('id="home-photo-grid"'));assert.ok(page.includes('id="host-auth-modal"'));assert.ok(page.includes('/party/original.js'));
  assert.doesNotMatch(page,/<script[^>]*src=["']https?:/i);assert.doesNotMatch(page,/\son(?:click|submit|change)=["']/i);
});

test('schedule boundaries and daylight-saving conversion',()=>{
  const start=DateTime.fromISO('2026-11-01T00:00',{zone:'America/Chicago'}).toMillis();
  const end=DateTime.fromISO('2026-11-01T03:00',{zone:'America/Chicago'}).toMillis();
  assert.equal(end-start,4*3600000);
  const c={archived:0,settings:{start:new Date(start).toISOString(),entriesClose:new Date(end-3600000).toISOString(),end:new Date(end).toISOString()}};
  assert.equal(phase(c,start-1),'scheduled');assert.equal(phase(c,start),'live');assert.equal(phase(c,end-3600000),'voting_only');assert.equal(phase(c,end),'closed');
  assert.equal(phase({...c,archived:1},start),'closed');
});

test('production refuses an unset password or insecure origin',()=>{
  assert.throws(()=>createApp({password:'short'}),/12 characters/);
  assert.throws(()=>createApp({password:'long-enough-test-password',production:true,origin:'http://example.com'}),/https/);
});
