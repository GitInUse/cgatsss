import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import {createApp} from '../server.js';
import {request} from './transport.js';
const origin='http://party.test';
const settings={timezone:'America/Chicago',start:'2027-10-31T17:00',entriesClose:'2027-10-31T20:00',end:'2027-10-31T21:00',categories:['Best'],submissionMode:'guest'};
async function fixture(t,extra={}){
 const dir=mkdtempSync(path.join(tmpdir(),'guest-demo-'));let clock=Date.now(),app;
 const options={dataDir:dir,localPreview:true,production:false,testing:true,now:()=>clock,...extra};app=createApp(options);
 t.after(()=>{app.locals.db.close();rmSync(dir,{recursive:true,force:true});});
 async function client(host=false){
  const cookies=new Map();let csrf='';
  const call=async(route,body,method=body?'POST':'GET',headersExtra={})=>{
   const headers={Cookie:[...cookies].map(([k,v])=>`${k}=${v}`).join('; '),...(body?{Origin:origin,'X-CSRF-Token':csrf,'Content-Type':'application/json'}:{}),...headersExtra};
   const res=await request(app,origin+route,{method,headers,body:body?JSON.stringify(body):undefined});
   for(const c of res.headers.getSetCookie()){const[k,v]=c.split(';')[0].split('=');if(!v)cookies.delete(k);else cookies.set(k,v);}
   const buffer=Buffer.from(await res.arrayBuffer()),data=res.headers.get('content-type')?.includes('application/json')?JSON.parse(buffer):buffer.toString();if(data.csrf)csrf=data.csrf;return{status:res.status,data,headers:res.headers};
  };
  await call('/api/guest-demo/session');if(host){await call('/api/state');assert.equal((await call('/api/login',{password:extra.password||'1031'})).status,200);}
  return {call,cookies};
 }
 const host=await client(true);
 const created=await host.call('/api/host/contests',{title:'Guest demo test',settings,requestId:'initial'});assert.equal(created.status,201);
 return {get app(){return app;},client,host,eventId:created.data.id,advance:ms=>{clock+=ms;},restart(){app.locals.db.close();app=createApp(options);}};
}
async function begin(client,eventId,email='ghost@example.test',displayName='Friendly Ghost'){
 const r=await client.call('/api/guest-demo/start',{eventId,email,displayName});assert.equal(r.status,201);assert.equal(r.data.emailSent,false);assert.ok(!r.data.verificationPath.includes('?'));return r.data.verificationPath.split('#verify=')[1];
}
async function login(client,eventId,email,displayName){const token=await begin(client,eventId,email,displayName);const r=await client.call('/api/guest-demo/verify',{eventId,token});assert.equal(r.status,200);return r;}

test('self-service demo uses fictional addresses, one-time hashed links and private returning sessions',async t=>{
 const f=await fixture(t),guest=await f.client(),other=await f.client();
 const page=await guest.call('/party/guest-demo/');assert.equal(page.status,200);assert.match(page.headers.get('cache-control'),/no-store/);assert.match(page.headers.get('x-robots-tag'),/noindex/);assert.match(page.data,/NO EMAILS SENT/);
 for(const email of ['real@gmail.com','ghost@example.com','x@example.test.evil','not an address'])assert.equal((await guest.call('/api/guest-demo/start',{eventId:f.eventId,email,displayName:'Ghost'})).status,400);
 const token=await begin(guest,f.eventId,'GHOST@EXAMPLE.TEST');
 const stored=f.app.locals.db.prepare('SELECT * FROM demo_guest_links').get();assert.notEqual(stored.id,token);assert.equal(stored.id,createHash('sha256').update(token).digest('hex'));assert.equal(stored.email,'ghost@example.test');
 assert.equal((await other.call('/api/guest-demo/verify',{eventId:f.eventId,token})).status,400);
 const simultaneous=await Promise.all([guest.call('/api/guest-demo/verify',{eventId:f.eventId,token}),guest.call('/api/guest-demo/verify',{eventId:f.eventId,token})]);assert.deepEqual(simultaneous.map(r=>r.status).sort(),[200,400]);const result=simultaneous.find(r=>r.status===200);assert.equal(result.data.guest.emailVerified,false);assert.equal(result.data.guest.identity,'demo-only');assert.match(result.headers.getSetCookie().join(';'),/HttpOnly/);
 assert.equal((await guest.call('/api/guest-demo/verify',{eventId:f.eventId,token})).status,400);
 assert.equal((await other.call('/api/guest-demo/session')).data.guest,null);
 const oldSession=guest.cookies.get('guest_demo');assert.equal(f.app.locals.db.prepare('SELECT id FROM demo_guest_sessions').get().id,createHash('sha256').update(oldSession).digest('hex'));
 const id=result.data.guest.id;assert.equal((await guest.call('/api/guest-demo/me',{displayName:'New Ghost',id:'someone-else'},'PUT')).status,200);
 assert.equal((await guest.call('/api/guest-demo/me',{displayName:'<script>test</script>'},'PUT')).status,200,'Names remain plain text');
 assert.equal((await guest.call('/api/guest-demo/me',{displayName:'New Ghost'},'PUT')).status,200);
 f.restart();assert.equal((await guest.call('/api/guest-demo/session')).data.guest.displayName,'New Ghost');
 await guest.call('/api/guest-demo/finish',{});assert.equal((await guest.call('/api/guest-demo/session')).data.guest,null);
 const replay=await guest.call('/api/guest-demo/session',undefined,'GET',{Cookie:'visitor='+guest.cookies.get('visitor')+'; guest_demo='+oldSession});assert.equal(replay.data.guest,null);
 const returning=await login(guest,f.eventId,'ghost@example.test','Different requested name');assert.equal(returning.data.guest.id,id);assert.equal(returning.data.guest.displayName,'New Ghost');
 assert.equal(f.app.locals.db.prepare('SELECT COUNT(*) n FROM demo_guests').get().n,1);
 f.advance(3600001);assert.equal((await guest.call('/api/guest-demo/session')).data.guest,null);
});

test('expiry, superseded links, cancellation, event isolation and existing auth boundaries hold',async t=>{
 const f=await fixture(t),guest=await f.client();
 let token=await begin(guest,f.eventId);f.advance(600001);assert.equal((await guest.call('/api/guest-demo/verify',{eventId:f.eventId,token})).status,400);
 token=await begin(guest,f.eventId);await begin(guest,f.eventId);assert.equal((await guest.call('/api/guest-demo/verify',{eventId:f.eventId,token})).status,400);
 token=await begin(guest,f.eventId);await guest.call('/api/guest-demo/finish',{});assert.equal((await guest.call('/api/guest-demo/verify',{eventId:f.eventId,token})).status,400);
 token=await begin(guest,f.eventId);assert.equal((await guest.call('/api/guest-demo/verify',{eventId:f.eventId,token},'POST',{Origin:'https://evil.test'})).status,403);
 await guest.call('/api/guest-demo/verify',{eventId:f.eventId,token});
 assert.equal((await guest.call('/api/state')).data.host,false);
 assert.equal((await guest.call('/api/host/contests')).status,401);assert.equal((await guest.call('/api/host/export')).status,401);
 f.app.locals.db.prepare('INSERT INTO entries VALUES (?,?,?,?,?,?,?,1,?)').run('private-photo',f.eventId,'Private Guest','Best','','not-public.jpg','other-owner',new Date().toISOString());
 assert.equal((await guest.call('/api/photos/private-photo')).status,404);
 assert.equal((await guest.call('/api/entries/private-photo',{name:'Hijack',caption:''},'PUT')).status,403);
 assert.equal((await guest.call('/api/host/contests',undefined,'GET',{Cookie:'host='+guest.cookies.get('guest_demo')})).status,401);
 f.app.locals.db.prepare('DELETE FROM entries WHERE id=?').run('private-photo');
 assert.equal((await guest.call('/api/guest-demo/guests')).status,404);
 const a=f.app.locals.db.prepare('SELECT settings FROM contests WHERE id=?').get(f.eventId);f.app.locals.db.prepare('UPDATE contests SET settings=? WHERE id=?').run(JSON.stringify({...JSON.parse(a.settings),override:'closed'}),f.eventId);
 const next=await f.host.call('/api/host/contests',{title:'Next test',settings,requestId:'next',expectedCurrentId:f.eventId});assert.equal(next.status,201);
 assert.equal((await guest.call('/api/guest-demo/session')).data.guest,null);
 assert.equal((await guest.call('/api/guest-demo/start',{eventId:f.eventId,email:'ghost@example.test',displayName:'Ghost'})).status,409);
 const nextLogin=await login(guest,next.data.id);assert.notEqual(nextLogin.data.guest.id,f.app.locals.db.prepare('SELECT id FROM demo_guests WHERE contest_id=?').get(f.eventId).id);
 const attacker=await f.client();attacker.cookies.set('guest_demo',guest.cookies.get('guest_demo'));assert.equal((await attacker.call('/api/guest-demo/session')).data.guest,null);
 assert.equal((await attacker.call('/api/guest-demo/me',{displayName:'Hijack'},'PUT')).status,401);
 assert.equal(f.app.locals.db.prepare('SELECT COUNT(*) n FROM votes').get().n,0);assert.equal(f.app.locals.db.prepare('SELECT COUNT(*) n FROM entries').get().n,0);
});

test('ordinary production never exposes the simulator or creates its tables',async t=>{
 const dir=mkdtempSync(path.join(tmpdir(),'guest-production-')),saved=process.env.DEMO_MODE;delete process.env.DEMO_MODE;
 const app=createApp({dataDir:dir,production:true,password:'production-only-test-password',recoveryCode:'production-only-test-recovery',origin:'https://production.test',localPreview:true,testing:true});
 t.after(()=>{app.locals.db.close();rmSync(dir,{recursive:true,force:true});if(saved===undefined)delete process.env.DEMO_MODE;else process.env.DEMO_MODE=saved;});
 for(const route of ['/party/guest-demo/','/party/guest-demo?demo=true','/api/guest-demo/session'])assert.equal((await request(app,'https://production.test'+route)).status,404);
 const stateResponse=await request(app,'https://production.test/api/state'),state=JSON.parse(Buffer.from(await stateResponse.arrayBuffer()));assert.equal(state.guestDemoAvailable,false);
 const cookies=stateResponse.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');
 for(const route of ['start','verify','finish'])assert.equal((await request(app,'https://production.test/api/guest-demo/'+route,{method:'POST',headers:{Cookie:cookies,Origin:'https://production.test','X-CSRF-Token':state.csrf,'Content-Type':'application/json'},body:'{}'})).status,404);
 assert.equal(app.locals.db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name LIKE 'demo_guest%'").get().n,0);
});

test('rate limits reject repeated registration and verification attempts',async t=>{
 const f=await fixture(t,{testing:false}),guest=await f.client();
 for(let i=0;i<40;i++)assert.equal((await guest.call('/api/guest-demo/start',{eventId:f.eventId,email:'ghost@example.test',displayName:'Ghost'})).status,201);
 assert.equal((await guest.call('/api/guest-demo/start',{eventId:f.eventId,email:'ghost@example.test',displayName:'Ghost'})).status,429);
 for(let i=0;i<60;i++)assert.equal((await guest.call('/api/guest-demo/verify',{eventId:f.eventId,token:'a'.repeat(64)})).status,400);
 assert.equal((await guest.call('/api/guest-demo/verify',{eventId:f.eventId,token:'a'.repeat(64)})).status,429);
 assert.equal(f.app.locals.db.prepare('SELECT COUNT(*) n FROM demo_guests').get().n,0);
});

function demoDocument(html){
 const elements=new Map(),buttons=[],events={};
 for(const match of html.matchAll(/<(\w+)\b([^>]*)>/g)){
  const attrs=Object.fromEntries([...match[2].matchAll(/([\w-]+)="([^"]*)"/g)].map(m=>[m[1],m[2]]));
  const el={value:'',textContent:'',hidden:/\bhidden\b/.test(match[2]),disabled:false,events:{},addEventListener(name,fn){this.events[name]=fn;},removeAttribute(name){delete attrs[name];},getAttribute:name=>attrs[name]??null,dispatch(name){return this.events[name]?.({preventDefault(){}});}};
  Object.defineProperty(el,'href',{get:()=>attrs.href,set:v=>{attrs.href=v;}});if(attrs.id)elements.set(attrs.id,el);if(match[1]==='button')buttons.push(el);
 }
 return{hidden:false,getElementById:id=>elements.get(id),querySelectorAll:()=>buttons,addEventListener:(name,fn)=>{events[name]=fn;},events};
}
const flush=async()=>{for(let i=0;i<15;i++)await new Promise(resolve=>setImmediate(resolve));};
test('shared-device UI clears fields, handles returning guests, and keeps offline sign-out private',async t=>{
 const f=await fixture(t),guest=await f.client(),html=(await guest.call('/party/guest-demo/')).data;
 const document=demoDocument(html),events={},timers=new Map();let offline=false;
 const location={hash:'',pathname:'/party/guest-demo/'},context={document,location,history:{replaceState(){location.hash='';}},AbortSignal,Date,setTimeout:(fn,ms)=>{timers.set(fn,ms);return fn;},clearTimeout:id=>timers.delete(id),addEventListener:(name,fn)=>{events[name]=fn;},fetch:async(url,options={})=>{if(offline)throw Error('Offline');const r=await guest.call(url,options.body?JSON.parse(options.body):undefined,options.method||'GET',options.headers||{});return{ok:r.status<400,status:r.status,json:async()=>r.data};}};
 vm.runInNewContext(readFileSync(new URL('../public/party/guest-demo.js',import.meta.url),'utf8'),context);
 const $=id=>document.getElementById(id);await events.pageshow();assert.equal($('register').hidden,false);
 $('guest-name').value='Friendly Ghost';$('guest-email').value='ghost@example.test';$('register-form').dispatch('submit');await flush();assert.equal($('inbox').hidden,false);assert.equal($('guest-email').value,'');assert.equal($('guest-name').value,'');assert.match($('demo-email-link').href,/#verify=[a-f0-9]{64}$/);
 $('demo-email-link').dispatch('click');assert.equal($('inbox-address').textContent,'');assert.equal($('verify').hidden,false);$('verify-button').dispatch('click');await flush();assert.equal($('welcome').hidden,false);assert.match($('welcome-name').textContent,/Friendly Ghost/);
 $('edit-name').value='<b>Ghost</b>';$('name-form').dispatch('submit');await flush();assert.equal($('welcome-name').textContent,'Welcome, <b>Ghost</b>!');
 offline=true;await $('finish').dispatch('click');assert.equal($('welcome').hidden,true);assert.equal($('welcome-name').textContent,'');assert.equal($('edit-name').value,'');assert.match($('status').textContent,/Could not confirm sign-out/);
 await events.pageshow();assert.equal($('welcome').hidden,true,'Back navigation must not reveal the previous guest during offline sign-out');
 offline=false;await $('retry').dispatch('click');assert.equal($('register').hidden,false);assert.equal((await guest.call('/api/guest-demo/session')).data.guest,null);
 $('guest-name').value='Next Guest';$('guest-email').value='next@example.test';$('register-form').dispatch('submit');await flush();$('demo-email-link').dispatch('click');$('verify-button').dispatch('click');await flush();assert.match($('welcome-name').textContent,/Next Guest/);assert.doesNotMatch($('welcome-name').textContent,/Ghost/);
 document.hidden=true;document.events.visibilitychange();assert.equal($('welcome-name').textContent,'');document.hidden=false;await document.events.visibilitychange();await flush();assert.match($('welcome-name').textContent,/Next Guest/);
});

test('explicit production demo uses secure cookies and never touches host or visitor voting credentials',async t=>{
 const saved=process.env.DEMO_MODE;process.env.DEMO_MODE='true';const dir=mkdtempSync(path.join(tmpdir(),'guest-secure-'));
 const app=createApp({dataDir:dir,production:true,origin:'https://demo.test',password:'secure-demo-test-password',recoveryCode:'secure-demo-test-recovery',testing:true});
 t.after(()=>{app.locals.db.close();rmSync(dir,{recursive:true,force:true});if(saved===undefined)delete process.env.DEMO_MODE;else process.env.DEMO_MODE=saved;});
 app.locals.db.prepare('INSERT INTO contests VALUES (?,?,?,0,?)').run('demo-event','Demo',JSON.stringify(settings),new Date().toISOString());
 const first=await request(app,'https://demo.test/api/guest-demo/session'),state=JSON.parse(Buffer.from(await first.arrayBuffer()));
 const visitor=first.headers.getSetCookie().find(v=>v.startsWith('visitor=')).split(';')[0];
 const post=async(route,body)=>{const r=await request(app,'https://demo.test/api/guest-demo/'+route,{method:'POST',headers:{Cookie:visitor,Origin:'https://demo.test','X-CSRF-Token':state.csrf,'Content-Type':'application/json'},body:JSON.stringify(body)});return{status:r.status,headers:r.headers,data:JSON.parse(Buffer.from(await r.arrayBuffer()))};};
 const started=await post('start',{eventId:'demo-event',email:'ghost@example.test',displayName:'Ghost'});assert.equal(started.status,201);
 const verified=await post('verify',{eventId:'demo-event',token:started.data.verificationPath.split('#verify=')[1]});assert.equal(verified.status,200);
 const cookies=verified.headers.getSetCookie();assert.equal(cookies.length,1);assert.match(cookies[0],/^guest_demo=/);assert.match(cookies[0],/HttpOnly/);assert.match(cookies[0],/Secure/);assert.match(cookies[0],/SameSite=Lax/);
 assert.equal(app.locals.db.prepare('SELECT COUNT(*) n FROM sessions').get().n,0);assert.equal(app.locals.db.prepare('SELECT COUNT(*) n FROM votes').get().n,0);
});
