import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {setImmediate as tick} from 'node:timers/promises';
import {renderPhotoBoothPage} from '../scripts/photobooth-demo-page.js';
import {createApp} from '../server.js';
import {request} from './transport.js';
const appScript=readFileSync(new URL('../public/party/photobooth-demo.js',import.meta.url),'utf8');
const sample=()=>({eventId:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',title:'Halloween Test',code:'1234',features:{takePhoto:true,enterContest:true},contestAvailable:true,contestMessage:'',contestUrl:'https://geech.idontthinkiwill.com/party/?view=enter&eventId=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'});
function welcomeFixture(selected=true){
 const elements=new Map(),events={},intervals=[],calls=[],navigations=[];let resets=0,offline=false,defer=false,pending;
 for(const id of renderPhotoBoothPage().matchAll(/id="([^"]+)"/g))elements.set(id[1],{value:'',hidden:true,disabled:false,textContent:'',events:{},addEventListener(name,fn){this.events[name]=fn;},dispatch(name){return this.events[name]?.({preventDefault(){}});},setAttribute(k,v){this[k]=v;},removeAttribute(k){delete this[k];}});
 const document={getElementById:id=>elements.get(id),hidden:false,addEventListener:(name,fn)=>{events['document:'+name]=fn;}};
 let config=sample();
 const respond=(method,body)=>{if(method==='DELETE'){selected=false;return Response.json({ok:true});}if(method==='POST'){const input=JSON.parse(body);if(input.code!=='1234')return Response.json({error:'Wrong code'},{status:400});selected=true;}return selected?Response.json(config):Response.json({error:'Enter your party code',needsParty:true},{status:409});};
 const context={document,console,AbortSignal,AbortController,JSON,setInterval:fn=>intervals.push(fn),addEventListener:(name,fn)=>{events[name]=fn;},location:{assign:url=>navigations.push(url)},createPhotoBooth:()=>({reset:()=>{resets++;}}),fetch:async(url,options)=>{calls.push({url,...options});if(offline)throw Error('Offline');if(defer){defer=false;return new Promise(resolve=>{pending=()=>resolve(respond(options.method,options.body));});}return respond(options.method,options.body);}};
 vm.runInNewContext(appScript,context,{filename:'photobooth-demo.js'});
 return {$:id=>elements.get(id),events,intervals,calls,navigations,document,get resets(){return resets;},setConfig:value=>{config=value;},offline:()=>{offline=true;},defer:()=>{defer=true;},resolve:()=>pending()};
}
async function flush(){for(let i=0;i<20;i++)await tick();}

test('booth welcome resolves a party, respects independent feature switches and remains device-only',async()=>{
 const f=welcomeFixture();await flush();assert.equal(f.$('booth-party-name').textContent,'Halloween Test');assert.equal(f.$('booth-party-code').textContent,'Party code: 1234');assert.equal(f.$('booth-welcome').hidden,false);assert.equal(f.$('booth-capture').hidden,true);
 for(const takePhoto of [false,true])for(const enterContest of [false,true]){const config={...sample(),features:{takePhoto,enterContest}};f.setConfig(config);await f.$('booth-retry').dispatch('click');assert.equal(f.$('booth-take-photo').hidden,!takePhoto);assert.equal(f.$('booth-enter-contest').hidden,!enterContest);assert.equal(f.$('booth-disabled').hidden,takePhoto||enterContest);}
 f.setConfig(sample());await f.$('booth-take-photo').dispatch('click');assert.equal(f.$('booth-capture').hidden,false);
 const before=f.resets;await f.$('finish-photo').dispatch('click');assert.ok(f.resets>before);assert.equal(f.$('booth-welcome').hidden,false);assert.equal(f.$('booth-capture').hidden,true);
 assert.ok(f.calls.every(c=>c.url==='/api/photobooth/context'),'Booth makes no photo-upload calls');assert.doesNotMatch(appScript,/email|localStorage|indexedDB|FormData/);
});

test('party code selection, unavailable contests and switching parties do not leave previous photos or late context',async()=>{
 const f=welcomeFixture(false);await flush();assert.equal(f.$('booth-select').hidden,false);
 f.$('booth-code-input').value='1234';await f.$('booth-code-form').dispatch('submit');assert.equal(f.$('booth-code-input').value,'1234');assert.equal(f.$('booth-welcome').hidden,false);
 f.setConfig({...sample(),contestAvailable:false,contestMessage:'Contest photos are handled by the host.'});await f.$('booth-retry').dispatch('click');assert.equal(f.$('booth-enter-contest')['aria-disabled'],'true');assert.equal(f.$('booth-enter-contest').href,undefined);await f.$('booth-enter-contest').dispatch('click');assert.equal(f.navigations.length,0);
 f.setConfig(sample());await f.$('booth-take-photo').dispatch('click');f.defer();const old=f.$('booth-retry').dispatch('click');await flush();await f.$('booth-switch-party').dispatch('click');f.resolve();await old;
 assert.equal(f.$('booth-select').hidden,false);assert.equal(f.$('booth-capture').hidden,true);assert.equal(f.$('booth-party-code').textContent,'');assert.equal(f.$('booth-code-input').value,'');assert.ok(f.calls.some(c=>c.signal?.aborted));
});

test('booth clears capture when the event changes, host disables it, page hides or server fails',async()=>{
 const f=welcomeFixture();await flush();await f.$('booth-take-photo').dispatch('click');f.setConfig({...sample(),features:{takePhoto:false,enterContest:true}});await f.intervals[0]();assert.equal(f.$('booth-capture').hidden,true);assert.match(f.$('booth-message').textContent,/turned off/);
 f.setConfig(sample());await f.$('booth-take-photo').dispatch('click');f.setConfig({...sample(),eventId:'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'});await f.intervals[0]();assert.equal(f.$('booth-capture').hidden,true);assert.match(f.$('booth-message').textContent,/event changed/);
 await f.$('booth-take-photo').dispatch('click');const before=f.resets;f.document.hidden=true;f.events['document:visibilitychange']();assert.ok(f.resets>before);assert.equal(f.$('booth-capture').hidden,true);
 f.document.hidden=false;f.offline();await f.$('booth-retry').dispatch('click');assert.equal(f.$('booth-select').hidden,false);assert.match(f.$('booth-message').textContent,/Offline/);
});

test('public booth configuration persists host switches and omits private party data',async t=>{
 const dir=mkdtempSync(path.join(tmpdir(),'booth-settings-')),origin='http://party.test',options={dataDir:dir,localPreview:true,testing:true,production:false,now:()=>Date.parse('2027-11-01T00:00Z')};let app=createApp(options);t.after(()=>{app.locals.db.close();rmSync(dir,{recursive:true,force:true});});
 const cookies=new Map();let csrf;
 async function call(route,body,method=body?'POST':'GET',guest=false){const headers={};if(!guest)headers.Cookie=[...cookies].map(([k,v])=>`${k}=${v}`).join('; ');if(body){headers.Origin=origin;headers['X-CSRF-Token']=csrf;headers['Content-Type']='application/json';}const r=await request(app,origin+route,{method,headers,body:body?JSON.stringify(body):undefined});if(!guest)for(const c of r.headers.getSetCookie()){const[k,v]=c.split(';')[0].split('=');cookies.set(k,v);}const data=JSON.parse(Buffer.from(await r.arrayBuffer()));if(data.csrf)csrf=data.csrf;return{status:r.status,data};}
 await call('/api/state');await call('/api/login',{password:'1031'});
 const settings={timezone:'America/Chicago',start:'2027-10-31T17:00',entriesClose:'2027-10-31T20:00',end:'2027-10-31T21:00',categories:['Best'],submissionMode:'guest'};
 const made=await call('/api/host/contests',{title:'Booth test',settings,requestId:'booth-test'});assert.equal(made.status,201);const id=made.data.id;
 for(const takePhoto of [false,true])for(const enterContest of [false,true]){assert.equal((await call('/api/host/contests/'+id,{title:'Booth test',settings:{...settings,booth:{takePhoto},modules:{enterContest}}},'PUT')).status,200);const config=await call('/api/photobooth/config',undefined,'GET',true);assert.deepEqual(config.data.features,{takePhoto,enterContest});assert.equal(config.data.contestAvailable,enterContest);assert.deepEqual(Object.keys(config.data).sort(),['contestAvailable','contestMessage','eventId','features','title']);}
 const hostOnly=await call('/api/host/contests/'+id,{title:'Booth test',settings:{...settings,submissionMode:'host_only'}},'PUT');assert.equal(hostOnly.status,200);assert.equal((await call('/api/photobooth/config')).data.contestAvailable,false);assert.match((await call('/api/photobooth/config')).data.contestMessage,/host/);
 await call('/api/host/contests/'+id,{title:'Booth test',settings:{...settings,start:'2028-10-31T17:00',entriesClose:'2028-10-31T20:00',end:'2028-10-31T21:00'}},'PUT');assert.equal((await call('/api/photobooth/config')).data.contestAvailable,false);
 await call('/api/host/contests/'+id,{title:'Booth test',settings},'PUT');
 for(const booth of [null,[],false,{takePhoto:'true'},{unknown:true}])assert.equal((await call('/api/host/contests/'+id,{title:'Booth test',settings:{...settings,booth}},'PUT')).status,400);
 await call('/api/host/contests/'+id,{title:'Booth test',settings:{...settings,booth:{takePhoto:false}}},'PUT');await call('/api/host/contests/'+id,{title:'Booth test',settings},'PUT');assert.equal((await call('/api/photobooth/config')).data.features.takePhoto,false,'Other settings saves preserve booth settings');
 app.locals.db.close();app=createApp(options);cookies.clear();await call('/api/state');assert.equal((await call('/api/photobooth/config')).data.features.takePhoto,false);assert.equal((await call('/api/state')).data.host,false);
});
