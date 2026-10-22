import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createApp,isPersistentPath} from '../server.js';
import {request} from './transport.js';

test('production HTTPS routes, secure host login, canonical URL and private storage',async()=>{
 for(const origin of ['https://sample-party.onrender.com','https://idontthinkiwill.com']){
  const dir=mkdtempSync(path.join(tmpdir(),'party-production-'));
  const app=createApp({dataDir:dir,production:true,password:'test-production-password',recoveryCode:'test-production-recovery',origin,testing:true});
  try{
   const call=async(route,options={})=>request(app,origin+route,{...options,headers:{'X-Forwarded-Proto':'https',...options.headers}});
   for(const route of ['/','/party/','/party/original.js','/party/original.css','/party/assets/championship-logo.png','/healthz','/api/qr']){
    const res=await call(route);assert.equal(res.status,200,route);assert.match(res.headers.get('strict-transport-security'),/max-age/);
   }
   const noSlash=await call('/party');assert.equal(noSlash.status,301);assert.equal(noSlash.headers.get('location'),'/party/');
   const alternate=await request(app,'https://alternate.example/party/?test=1');assert.equal(alternate.status,308);assert.equal(alternate.headers.get('location'),origin+'/party/?test=1');
   assert.equal((await request(app,'http://internal.example/healthz')).status,200);
   const stateResponse=await call('/api/state'),state=JSON.parse(Buffer.from(await stateResponse.arrayBuffer()).toString());
   const visitor=stateResponse.headers.getSetCookie();assert.match(visitor[0],/HttpOnly/);assert.match(visitor[0],/Secure/);
   const headers={Origin:origin,'Content-Type':'application/json','X-CSRF-Token':state.csrf,Cookie:visitor.map(c=>c.split(';')[0]).join('; ')};
   assert.equal((await call('/api/login',{method:'POST',headers,body:JSON.stringify({password:'1031'})})).status,401);
   const login=await call('/api/login',{method:'POST',headers,body:JSON.stringify({password:'test-production-password'})});assert.equal(login.status,200);
   assert.match(login.headers.getSetCookie()[0],/HttpOnly.*Secure|Secure.*HttpOnly/);
   headers.Cookie+='; '+login.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
   assert.equal((await call('/api/host/contests',{headers})).status,200);
   assert.equal((await call('/api/host/password',{method:'POST',headers:{...headers,Origin:'https://attacker.example'},body:JSON.stringify({password:'another-test-password'})})).status,403);
   for(const route of ['/data/party.sqlite','/photos/private.jpg','/backups/2026-10-21.sqlite','/test-results/host-recovery-code.txt','/.env','/.git/config','/server.js','/render.yaml'])assert.equal((await call(route)).status,404,route);
   assert.equal((await call('/api/host/export')).status,401);
  }finally{app.locals.db.close();rmSync(dir,{recursive:true,force:true});}
 }
});

test('unsafe storage and production configuration fail before data is opened',()=>{
 const privatePath=path.resolve('public','must-not-create-data');
 assert.throws(()=>createApp({dataDir:privatePath,password:'test-production-password'}),/outside public/);assert.equal(existsSync(privatePath),false);
 for(const origin of ['http://example.com','https://example.com/','https://example.com?query=1','https://user:pass@example.com'])assert.throws(()=>createApp({production:true,password:'test-production-password',origin}),/https website origin/);
 assert.throws(()=>createApp({production:true,password:'test-production-password',origin:'https://example.com',recoveryCode:''}),/HOST_RECOVERY_CODE/);
 const mounts='1 0 8:1 / / rw - ext4 /dev/root rw\n2 1 8:2 / /var/data rw - ext4 /dev/data rw';
 assert.equal(isPersistentPath('/var/data','/var/data',mounts),true);
 assert.equal(isPersistentPath('/var/data/restored-2026','/var/data',mounts),true);
 assert.equal(isPersistentPath('/var/database','/var/data',mounts),false);
 assert.equal(isPersistentPath('/var/data','/var/data',mounts.split('\n')[0]),false);
 assert.equal(isPersistentPath('/var/data','/',mounts),false);
});
