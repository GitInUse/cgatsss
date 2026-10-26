import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {createApp} from '../server.js';
import {photoBoothDemoPage} from '../scripts/photobooth-demo-page.js';
import {request} from './transport.js';
const script=readFileSync(new URL('../public/party/camera-controller.js',import.meta.url),'utf8')+'\n'+readFileSync(new URL('../public/party/photobooth-demo.js',import.meta.url),'utf8');
function fixture({error,unsupported=false,deferPermission=false,deferBlob=false}={}){
 const elements=new Map(),events={},timers=new Map(),created=[],revoked=[],streams=[],calls=[];let permissionResolve,blobResolve,draws=0,sequence=0;
 function element(tag='div'){const attrs={},events={};return{tagName:tag.toUpperCase(),hidden:false,disabled:false,value:'',textContent:'',children:[],events,append(child){this.children.push(child);},replaceChildren(){this.children=[];},addEventListener(name,fn){events[name]=fn;},removeAttribute(name){delete attrs[name];},getAttribute:name=>attrs[name]??null,dispatch(name){return events[name]?.({preventDefault(){}});},get src(){return attrs.src;},set src(v){attrs.src=v;},get href(){return attrs.href;},set href(v){attrs.href=v;},get download(){return attrs.download;},set download(v){attrs.download=v;}};}
 for(const m of photoBoothDemoPage.matchAll(/<(\w+)\b([^>]*\bid="([^"]+)"[^>]*)>/g)){const el=element(m[1]);el.hidden=/\bhidden\b/.test(m[2]);elements.set(m[3],el);}
 const $=id=>elements.get(id),video=$('camera-preview');video.readyState=2;video.videoWidth=2560;video.videoHeight=1440;video.srcObject=null;video.pause=()=>{};video.play=async()=>{};$('countdown-seconds').value='3';
 const document={hidden:false,getElementById:$,addEventListener:(name,fn)=>{events['document:'+name]=fn;},createElement:tag=>{const el=element(tag);if(tag==='canvas'){el.width=0;el.height=0;el.getContext=()=>({drawImage(){draws++;}});el.toBlob=(fn,type,quality)=>{calls.push({encode:true,type,quality,width:el.width,height:el.height});if(deferBlob)blobResolve=fn;else fn(new Blob(['fake-jpeg'],{type}));};created.push(el);}return el;}};
 function makeStream(){const track={stopped:false,onended:null,stop(){this.stopped=true;},getSettings:()=>({deviceId:'webcam-1'})};const value={track,getTracks:()=>[track],getVideoTracks:()=>[track]};streams.push(value);return value;}
 const mediaDevices=unsupported?undefined:{async getUserMedia(options){calls.push(options);if(error)throw Object.assign(new Error('camera test'),{name:error});if(deferPermission)return new Promise(resolve=>{permissionResolve=()=>resolve(makeStream());});return makeStream();},async enumerateDevices(){return[{kind:'videoinput',deviceId:'webcam-1',label:'Test webcam'},{kind:'videoinput',deviceId:'webcam-2',label:'Second camera'}];}};
 const context={document,navigator:{mediaDevices},isSecureContext:true,Blob,Date,URL:{createObjectURL:()=>{const value='blob:test-'+(++sequence);calls.push({blobURL:value});return value;},revokeObjectURL:value=>revoked.push(value)},setTimeout:(fn,ms)=>{timers.set(fn,ms);return fn;},clearTimeout:fn=>timers.delete(fn),addEventListener:(name,fn)=>{events[name]=fn;}};
 vm.runInNewContext(script,context);events.pageshow();
 return{$,events,document,timers,created,revoked,streams,calls,get draws(){return draws;},resolvePermission:()=>permissionResolve(),resolveBlob:()=>blobResolve(new Blob(['fake-jpeg'],{type:'image/jpeg'})),tick(){const item=[...timers.keys()][0];assert.ok(item);timers.delete(item);item();}};
}
const flush=async()=>{for(let i=0;i<5;i++)await new Promise(resolve=>setImmediate(resolve));};
test('camera is explicit, audio stays off, capture needs approval, and finish releases resources',async()=>{
 const f=fixture();assert.equal(f.calls.length,0);assert.equal(f.$('start-panel').hidden,false);
 await f.$('start-camera').dispatch('click');assert.equal(f.calls[0].audio,false);assert.equal(f.$('take-photo').disabled,false);assert.equal(f.$('device-label').hidden,false);
 f.$('countdown-seconds').value='0';await f.$('take-photo').dispatch('click');assert.equal(f.draws,1);assert.equal(f.streams[0].track.stopped,true);assert.equal(f.$('review-panel').hidden,false);assert.equal(f.$('download-photo').href,undefined);
 const encoded=f.calls.find(c=>c.encode);assert.equal(encoded.type,'image/jpeg');assert.equal(encoded.width,1920);assert.equal(encoded.height,1080);assert.equal(f.created[0].width,0);assert.equal(f.$('photo-preview').src,'blob:test-1');
 f.$('approve-photo').dispatch('click');assert.equal(f.$('approved-panel').hidden,false);assert.equal(f.$('download-photo').href,'blob:test-1');assert.match(f.$('download-photo').download,/\.jpg$/);
 f.$('finish-photo').dispatch('click');assert.equal(f.$('photo-preview').src,undefined);assert.equal(f.$('download-photo').href,undefined);assert.deepEqual(f.revoked,['blob:test-1']);assert.equal(f.$('start-panel').hidden,false);assert.equal(f.$('camera-preview').srcObject,null);
 assert.doesNotMatch(script,/fetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|localStorage|indexedDB|sessionStorage/);
});
test('countdown cancels; late permission and photo callbacks cannot restore a previous guest',async()=>{
 const f=fixture();await f.$('start-camera').dispatch('click');const capturing=f.$('take-photo').dispatch('click');assert.equal(f.$('capture-countdown').textContent,'3');f.tick();await flush();assert.equal(f.$('capture-countdown').textContent,'2');f.$('stop-camera').dispatch('click');await capturing;assert.equal(f.draws,0);assert.equal(f.streams[0].track.stopped,true);assert.equal(f.timers.size,0);
 const late=fixture({deferPermission:true});const opening=late.$('start-camera').dispatch('click');late.$('stop-camera').dispatch('click');late.resolvePermission();await opening;assert.equal(late.streams[0].track.stopped,true);assert.equal(late.$('start-panel').hidden,false);
 const encoding=fixture({deferBlob:true});await encoding.$('start-camera').dispatch('click');encoding.$('countdown-seconds').value='0';const work=encoding.$('take-photo').dispatch('click');encoding.events.pagehide();encoding.resolveBlob();await work;assert.equal(encoding.$('photo-preview').src,undefined);assert.equal(encoding.calls.some(c=>c.blobURL),false);
});
test('retake, camera selection, backgrounding and disconnection clear the previous capture',async()=>{
 const f=fixture();await f.$('start-camera').dispatch('click');f.$('camera-device').value='webcam-2';await f.$('camera-device').dispatch('change');assert.equal(f.streams[0].track.stopped,true);assert.equal(f.calls.filter(c=>'video'in c)[1].video.deviceId.exact,'webcam-2');
 f.$('countdown-seconds').value='0';await f.$('take-photo').dispatch('click');await f.$('retake-photo').dispatch('click');assert.deepEqual(f.revoked,['blob:test-1']);assert.equal(f.$('photo-preview').src,undefined);
 f.document.hidden=true;f.events['document:visibilitychange']();assert.equal(f.streams.at(-1).track.stopped,true);assert.equal(f.$('start-panel').hidden,false);
 f.document.hidden=false;f.events.pageshow();assert.equal(f.calls.filter(c=>'video'in c).length,3);
 await f.$('start-camera').dispatch('click');f.streams.at(-1).track.onended();assert.match(f.$('camera-status').textContent,/disconnected/);assert.equal(f.$('camera-preview').srcObject,null);
});
test('unavailable or denied cameras show usable errors without requesting audio',async()=>{
 const unsupported=fixture({unsupported:true});await unsupported.$('start-camera').dispatch('click');assert.match(unsupported.$('camera-status').textContent,/HTTPS/);assert.equal(unsupported.calls.length,0);
 for(const [name,pattern]of [['NotAllowedError',/permission/],['NotFoundError',/No usable camera/],['NotReadableError',/other apps/]]){const f=fixture({error:name});await f.$('start-camera').dispatch('click');assert.match(f.$('camera-status').textContent,pattern);assert.equal(f.$('start-panel').hidden,false);assert.equal(f.calls[0].audio,false);}
 const f=fixture();await f.$('start-camera').dispatch('click');f.$('camera-preview').readyState=0;f.$('camera-preview').events.loadeddata();assert.equal(f.$('take-photo').disabled,true);await f.$('take-photo').dispatch('click');assert.equal(f.draws,0);
});
test('legacy demo redirects to the independent booth and stays disabled outside demo mode',async()=>{
 for(const enabled of [false,true]){const dir=mkdtempSync(path.join(tmpdir(),'booth-page-')),app=createApp({dataDir:dir,production:false,localPreview:enabled,password:'test-only-booth-password',testing:true});try{for(const route of ['/party/photobooth-demo','/party/photobooth-demo/']){const response=await request(app,'http://party.test'+route);assert.equal(response.status,enabled?302:404);if(enabled)assert.equal(response.headers.get('location'),'https://idontthinkiwill.com/photobooth');}assert.equal(app.locals.db.prepare('SELECT COUNT(*) n FROM entries').get().n,0);}finally{app.locals.db.close();rmSync(dir,{recursive:true,force:true});}}
});
