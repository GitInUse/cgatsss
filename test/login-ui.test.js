// Offline interaction test: executes the real page script against a small DOM fixture
// and the real Express app. No browser, network socket, or website access is used.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setImmediate as tick } from 'node:timers/promises';
import { createApp } from '../server.js';
import { request } from './transport.js';
import sharp from 'sharp';

function fixture(html) {
  const all=[];
  function matches(n, selector) {
    // CSS class names containing '/' require escaping; attribute values don't.
    if(selector.includes('/') && !selector.includes('"')) throw new SyntaxError('Invalid selector');
    if(selector==='[class~="bg-black/40"]')return n.className.split(/\s+/).includes('bg-black/40');
    if(selector.startsWith('.'))return n.className.split(/\s+/).includes(selector.slice(1));
    if(selector.startsWith('[')){const m=selector.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);return m&&n.attrs[m[1]]!==undefined&&(m[2]===undefined||n.attrs[m[1]]===m[2]);}
    return n.tagName===selector.toUpperCase();
  }
  class Element {
    constructor(tag,attrs={}){this.tagName=tag.toUpperCase();this.attrs=attrs;this.id=attrs.id||'';this.className=attrs.class||'';this.value=attrs.value||'';this.children=[];this.parentElement=null;this.textContent='';this.style={};this.events={};all.push(this);}
    get classList(){return{add:(c)=>{if(!this.className.split(/\s+/).includes(c))this.className+=' '+c;},remove:(c)=>{this.className=this.className.split(/\s+/).filter(v=>v!==c).join(' ');},toggle:(c,on)=>{const has=this.className.split(/\s+/).includes(c);const next=on===undefined?!has:on;this.classList[next?'add':'remove'](c);return next;},contains:c=>this.className.split(/\s+/).includes(c)};}
    get dataset(){return Object.fromEntries(Object.entries(this.attrs).filter(([k])=>k.startsWith('data-')).map(([k,v])=>[k.slice(5),v]));}
    append(...children){for(const c of children){c.parentElement=this;this.children.push(c);}}
    replaceChildren(...children){this.children=[];this.append(...children);}
    after(other){const p=this.parentElement;other.parentElement=p;p.children.splice(p.children.indexOf(this)+1,0,other);}
    querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
    querySelectorAll(selector){const found=[];const visit=n=>{for(const c of n.children){if(matches(c,selector))found.push(c);visit(c);}};visit(this);return found;}
    closest(selector){let n=this;while(n){if(matches(n,selector))return n;n=n.parentElement;}return null;}
    setAttribute(k,v){this.attrs[k]=v;if(k==='id')this.id=v;}
    getAttribute(k){return this.attrs[k]??null;}
    removeAttribute(k){delete this.attrs[k];}
    addEventListener(name,fn){(this.events[name]??=[]).push(fn);}
    dispatch(name,extras={}){for(const fn of this.events[name]||[])fn({target:this,currentTarget:this,preventDefault(){},stopPropagation(){},...extras});}
    scrollIntoView(){}
  }
  const root=new Element('document'),stack=[root];
  const voids=new Set(['meta','link','input','img','br','hr','source']);
  for(const match of html.matchAll(/<!--[\s\S]*?-->|<\/?([a-zA-Z][\w-]*)\b([^>]*)>/g)){
    if(!match[1])continue;const tag=match[1].toLowerCase();
    if(match[0].startsWith('</')){if(stack.length>1)stack.pop();continue;}
    const attrs=Object.fromEntries([...match[2].matchAll(/([\w-]+)="([^"]*)"/g)].map(m=>[m[1],m[2]]));
    const element=new Element(tag,attrs);stack.at(-1).append(element);if(!voids.has(tag)&&!match[0].endsWith('/>'))stack.push(element);
  }
  return {getElementById:id=>all.find(n=>n.id===id)||null,createElement:tag=>new Element(tag),querySelectorAll:s=>root.querySelectorAll(s),addEventListener(){},hidden:false};
}

test('original page unlocks and gallery photos enlarge with voting instead of editing',async t=>{
  const dir=mkdtempSync(path.join(tmpdir(),'party-ui-'));
  let clock=Date.now();
  const recoveryCode='test-only-recovery-code-123456';
  const app=createApp({dataDir:dir,localPreview:true,production:false,testing:true,now:()=>clock,recoveryCode});
  t.after(()=>{app.locals.db.close();rmSync(dir,{recursive:true,force:true});});
  const html=readFileSync(new URL('../public/party/index.html',import.meta.url),'utf8');
  const script=readFileSync(new URL('../public/party/original.js',import.meta.url),'utf8');
  const document=fixture(html),cookies=new Map(),origin='http://party.test';
  const intervals=[];
  const context={document,console,FormData,URL,AbortSignal,Intl,Date,Promise,setTimeout:()=>0,clearTimeout(){},setInterval:fn=>{intervals.push(fn);return 0;},location:{origin},scrollTo(){},confirm:()=>false,prompt:()=>null};
  context.window=context;
  context.fetch=async(url,options={})=>{
    const headers={...options.headers,Cookie:[...cookies].map(([k,v])=>`${k}=${v}`).join('; ')};
    if(options.method&&options.method!=='GET')headers.Origin=origin;
    const response=await request(app,origin+url,{...options,headers});
    for(const c of response.headers.getSetCookie()){const [pair]=c.split(';');const[k,v]=pair.split('=');cookies.set(k,v);}
    return {ok:response.status<400,status:response.status,json:async()=>JSON.parse(Buffer.from(await response.arrayBuffer()).toString())};
  };
  vm.runInNewContext(script,context,{filename:'original.js'});
  for(let i=0;i<20;i++)await tick();
  const $=id=>document.getElementById(id);
  assert.equal($('app-container').parentElement,$('page-scroll'));
  assert.equal($('archive-panel').parentElement,$('page-scroll'));
  assert.equal($('party-navigation').parentElement.tagName,'BODY');
  assert.equal($('party-navigation').classList.contains('fixed'),false,'Navigation must reserve its own row rather than overlay scrollable content');
  const scrolls=[];$('page-scroll').scrollTo=options=>scrolls.push(options);
  context.switchView('main');assert.equal(scrolls.at(-1).top,0);
  assert.equal($('host-auth-label').textContent,'Host Unlock');
  context.openHostAuthModal();
  assert.equal($('host-auth-modal').classList.contains('hidden'),false);
  $('host-pin-input').value='0000';$('host-unlock-submit').dispatch('click');
  for(let i=0;i<20;i++)await tick();
  assert.match($('host-login-error').textContent,/Incorrect host password/);
  assert.equal($('host-unlock-submit').disabled,false);
  $('host-pin-input').value='1031';$('host-unlock-submit').dispatch('click');
  for(let i=0;i<30;i++)await tick();
  assert.equal($('host-auth-modal').classList.contains('hidden'),true);
  assert.equal($('view-host').classList.contains('hidden'),false);
  assert.equal($('host-auth-label').textContent,'Host Dashboard');
  assert.equal($('archive-panel').classList.contains('hidden'),false);
  const settings={start:new Date(clock-3600000).toISOString(),entriesClose:new Date(clock+3600000).toISOString(),end:new Date(clock+7200000).toISOString(),timezone:'America/Chicago',categories:['Funniest','Kids'],submissionMode:'guest',override:'auto'};
  app.locals.db.prepare('INSERT INTO contests VALUES (?,?,?,0,?)').run('gallery-test','Gallery test',JSON.stringify(settings),new Date(clock).toISOString());
  app.locals.db.prepare('INSERT INTO entries VALUES (?,?,?,?,?,?,?,0,?)').run('photo-one','gallery-test','Ghost','Funniest','Boo!','sample.jpg','test-owner',new Date(clock).toISOString());
  await intervals[0]();
  const initialClock=clock;
  clock-=2*3600000;await intervals[0]();assert.equal($('countdown-banner').children.length,3);
  assert.equal($('message-board-feed').closest('.panel-card').classList.contains('hidden'),false);
  assert.equal($('msg-text-input').disabled,true);
  clock=initialClock;await intervals[0]();assert.equal($('countdown-banner').children.length,2);
  assert.equal($('msg-text-input').disabled,false);
  context.clearAllEntries();assert.equal($('next-party-submit').disabled,true);
  assert.match($('next-party-status').textContent,/current party is live/);
  $('next-party-cancel').dispatch('click');
  clock+=3600000;await intervals[0]();assert.equal($('countdown-banner').children.length,1);
  clock+=3600000;await intervals[0]();assert.equal($('countdown-banner').children.length,0);
  assert.equal($('countdown-banner').classList.contains('hidden'),true);
  assert.equal($('message-board-feed').closest('.panel-card').classList.contains('hidden'),false);
  assert.equal($('msg-text-input').disabled,true);
  clock=initialClock;await intervals[0]();
  context.switchView('info');assert.equal($('view-info').classList.contains('hidden'),false);
  assert.equal($('view-main').classList.contains('hidden'),true);context.switchView('main');
  assert.equal($('host-timezone').getAttribute('type'),'hidden');
  const categoryOption=$('entry-category').children[0];await intervals[0]();
  assert.equal($('entry-category').children[0],categoryOption,'Polling must not rebuild a category dropdown while it is being used');
  context.openEntryInfoModal('photo-one');assert.equal($('modal-entry-category').disabled,false);
  $('modal-entry-category').value='Kids';await context.saveEntryDetails({preventDefault(){}});
  assert.equal(app.locals.db.prepare('SELECT category FROM entries WHERE id=?').get('photo-one').category,'Kids');
  context.openEntryInfoModal('photo-one');$('modal-entry-category').value='Funniest';await context.saveEntryDetails({preventDefault(){}});
  $('home-photo-grid').children[0].dispatch('click');
  assert.equal($('lightbox-modal').classList.contains('hidden'),false);
  assert.equal($('entry-info-modal').classList.contains('hidden'),true);
  assert.equal($('lightbox-img').src,'/api/photos/photo-one');
  assert.equal($('lightbox-vote').classList.contains('hidden'),false);
  assert.equal($('lightbox-vote').disabled,false);
  $('lightbox-vote').dispatch('click');
  assert.equal($('lightbox-modal').classList.contains('hidden'),true);
  assert.equal($('vote-confirm-modal').classList.contains('hidden'),false);
  await context.confirmCastVote();
  context.openEntryInfoModal('photo-one');assert.equal($('modal-entry-category').disabled,true);
  assert.match($('entry-category-help').textContent,/votes/);context.closeEntryInfoModal();
  $('home-photo-grid').children[0].dispatch('click');
  assert.equal($('lightbox-vote').disabled,true);
  assert.match($('lightbox-vote').textContent,/You voted for this photo/);
  clock+=3*3600000;
  app.locals.db.prepare('INSERT INTO winners VALUES (?,?,?,?)').run('gallery-test','Funniest','photo-one',new Date(clock).toISOString());
  await intervals[0]();
  $('home-photo-grid').children[0].dispatch('click');
  assert.equal($('lightbox-modal').classList.contains('hidden'),false);
  assert.equal($('lightbox-vote').classList.contains('hidden'),true);
  context.openWizardModal();context.goToWizardStep(2);
  for(const mode of ['host_only','hybrid','guest']){
    $(`sub-mode-${mode}-btn`).dispatch('click');
    assert.equal($(`sub-mode-${mode}-btn`).getAttribute('aria-pressed'),'true');
    assert.equal($(`sub-mode-${mode}-btn`).classList.contains('bg-purple-600/30'),true);
    for(const other of ['guest','host_only','hybrid'].filter(v=>v!==mode))assert.equal($(`sub-mode-${other}-btn`).getAttribute('aria-pressed'),'false');
  }
  $('sub-mode-hybrid-btn').dispatch('click');
  context.goToWizardStep(3);context.goToWizardStep(2);
  assert.equal($('sub-mode-hybrid-btn').getAttribute('aria-pressed'),'true');
  assert.equal($('wizard-mode-status').textContent,'Selected: Hybrid (Both)');
  context.confirm=()=>true;
  $('host-tagline').value='Claim the Belt!';
  await context.finishHostWizard();
  assert.equal($('party-tagline').textContent,'Claim the Belt!');
  assert.equal(JSON.parse(app.locals.db.prepare('SELECT settings FROM contests WHERE id=?').get('gallery-test').settings).tagline,'Claim the Belt!');
  assert.equal(JSON.parse(app.locals.db.prepare('SELECT settings FROM contests WHERE id=?').get('gallery-test').settings).submissionMode,'hybrid');
  context.openWizardModal();context.goToWizardStep(2);
  assert.equal($('sub-mode-hybrid-btn').getAttribute('aria-pressed'),'true');
  await context.lockHostSession();context.openHostAuthModal();
  $('host-recovery-toggle').dispatch('click');
  assert.equal($('host-auth-modal').querySelector('h3').textContent,'Host Recovery Code');
  $('host-pin-input').value=recoveryCode;$('host-unlock-submit').dispatch('click');
  for(let i=0;i<30;i++)await tick();
  assert.equal($('view-host').classList.contains('hidden'),false);
  assert.equal($('host-auth-modal').classList.contains('hidden'),true);
  context.openPinChangeModal();
  assert.equal($('pin-change-modal').classList.contains('hidden'),false);
  $('new-pin-input').value='5928';$('confirm-pin-input').value='5929';$('password-change-save').dispatch('click');
  for(let i=0;i<20;i++)await tick();
  assert.match($('password-change-error').textContent,/do not match/);
  $('confirm-pin-input').value='5928';$('password-change-save').dispatch('click');
  for(let i=0;i<30;i++)await tick();
  assert.equal($('pin-change-modal').classList.contains('hidden'),true);
  assert.ok(app.locals.db.prepare('SELECT hash FROM host_credentials WHERE id=1').get());
  $('host-wizard-modal').classList.add('hidden');
  const beforeCount=app.locals.db.prepare('SELECT COUNT(*) AS n FROM contests').get().n;
  context.clearAllEntries();
  assert.equal($('next-party-modal').classList.contains('hidden'),false);
  assert.equal($('next-party-name-choice').value,'same');
  assert.equal($('next-party-name').value,'Gallery test');
  $('next-party-submit').dispatch('click');
  assert.match($('next-party-status').textContent,/Enter new dates/);
  for(const [id,value]of [['next-party-start','2027-10-31T17:00'],['next-party-entries-close','2027-10-31T20:00'],['next-party-end','2027-10-31T21:00']])$(id).value=value;
  $('next-party-submit').dispatch('click');
  assert.match($('next-party-review').textContent,/Archive Gallery test and create Gallery test/);
  $('next-party-cancel').dispatch('click');
  assert.equal(app.locals.db.prepare('SELECT COUNT(*) AS n FROM contests').get().n,beforeCount);
  context.clearAllEntries();$('next-party-name-choice').value='new';$('next-party-name-choice').dispatch('change');
  assert.equal($('next-party-name').disabled,false);$('next-party-name').value='Next Halloween';
  for(const [id,value]of [['next-party-start','2027-10-31T17:00'],['next-party-entries-close','2027-10-31T20:00'],['next-party-end','2027-10-31T21:00']])$(id).value=value;
  $('next-party-submit').dispatch('click');$('next-party-back').dispatch('click');
  assert.equal($('next-party-fields').classList.contains('hidden'),false);
  $('next-party-submit').dispatch('click');$('next-party-submit').dispatch('click');$('next-party-submit').dispatch('click');
  for(let i=0;i<40;i++)await tick();
  const next=app.locals.db.prepare('SELECT * FROM contests WHERE archived=0').get();
  assert.equal(next.title,'Next Halloween');assert.equal(app.locals.db.prepare('SELECT COUNT(*) AS n FROM contests').get().n,beforeCount+1);
  assert.equal(JSON.parse(next.settings).tagline,'Claim the Belt!');assert.equal(JSON.parse(next.settings).submissionMode,'hybrid');
  assert.equal($('undo-next-party').disabled,false);assert.equal($('party-backup-reminder').classList.contains('hidden'),false);
  $('next-party-cancel').dispatch('click');context.confirm=()=>false;$('undo-next-party').dispatch('click');
  assert.equal(app.locals.db.prepare('SELECT id FROM contests WHERE archived=0').get().id,next.id);
  context.confirm=()=>true;$('undo-next-party').dispatch('click');
  for(let i=0;i<40;i++)await tick();
  const restored=app.locals.db.prepare('SELECT * FROM contests WHERE archived=0').get();
  assert.equal(restored.id,'gallery-test');assert.equal(JSON.parse(restored.settings).override,'closed');
  assert.equal(app.locals.db.prepare('SELECT archived FROM contests WHERE id=?').get(next.id).archived,1);
  assert.equal($('undo-next-party').classList.contains('hidden'),true);
  const jpeg=await sharp({create:{width:16,height:16,channels:3,background:'#ff8800'}}).jpeg().toBuffer();
  $('host-pw-name').value='Historical Ghost';$('host-pw-category').value='Spookiest';$('host-pw-year').value='2019 Champion';
  $('host-pw-file').files=[new File([jpeg],'winner.jpg',{type:'image/jpeg'})];
  await context.addHostPastWinner();
  assert.match($('hall-form-status').textContent,/saved privately/);
  const historical=app.locals.db.prepare("SELECT e.* FROM entries e JOIN contests c ON e.contest_id=c.id WHERE json_extract(c.settings,'$.historical')=1").get();
  assert.equal(historical.name,'Historical Ghost');
  let hallRow=$('host-past-winners-list').children.find(row=>row.querySelector('h4')?.textContent==='Historical Ghost');
  hallRow.querySelectorAll('button')[1].dispatch('click');for(let i=0;i<40;i++)await tick();
  assert.ok(app.locals.db.prepare('SELECT 1 FROM winners WHERE entry_id=?').get(historical.id));
  hallRow=$('host-past-winners-list').children.find(row=>row.querySelector('h4')?.textContent==='Historical Ghost');
  hallRow.querySelectorAll('button')[0].dispatch('click');
  assert.equal($('hall-form-heading').textContent,'Edit Historical Winner');
  $('host-pw-file').files=[];$('host-pw-name').value='Edited Champion';await context.addHostPastWinner();
  assert.equal(app.locals.db.prepare('SELECT name FROM entries WHERE id=?').get(historical.id).name,'Edited Champion');
  hallRow=$('host-past-winners-list').children.find(row=>row.querySelector('h4')?.textContent==='Edited Champion');
  hallRow.querySelectorAll('button')[1].dispatch('click');for(let i=0;i<40;i++)await tick();
  assert.equal(app.locals.db.prepare('SELECT 1 FROM winners WHERE entry_id=?').get(historical.id),undefined);
});
