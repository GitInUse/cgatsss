import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createApp} from '../server.js';
import {request} from './transport.js';

test('host password change persists, revokes other sessions and preserves recovery',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'party-password-'));
 let app;
 const options={dataDir:dir,localPreview:true,production:false,testing:true,recoveryCode:'Recovery1234'};
 async function client(){
  const cookies=new Map(),origin='http://party.test';let csrf;
  const call=async(route,body)=>{
   const headers={Cookie:[...cookies].map(([k,v])=>`${k}=${v}`).join('; ')};
   if(body){headers.Origin=origin;headers['Content-Type']='application/json';headers['X-CSRF-Token']=csrf;}
   const res=await request(app,origin+route,{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined});
   for(const c of res.headers.getSetCookie()){const[k,v]=c.split(';')[0].split('=');cookies.set(k,v);}return res;
  };
  const state=await call('/api/state');csrf=JSON.parse(Buffer.from(await state.arrayBuffer()).toString()).csrf;return call;
 }
 try{
  app=createApp(options);const a=await client(),b=await client();
  assert.equal((await a('/api/host/password',{password:'5928'})).status,401);
  assert.equal((await a('/api/login',{password:'1031'})).status,200);
  assert.equal((await b('/api/login',{password:'1031'})).status,200);
  assert.equal((await a('/api/host/password',{password:'tiny'})).status,400);
  assert.equal((await a('/api/host/password',{password:'5928'})).status,200);
  assert.equal((await b('/api/host/contests')).status,401);
  assert.equal((await a('/api/host/contests')).status,200);
  app.locals.db.close();app=createApp(options);const c=await client();
  assert.equal((await c('/api/login',{password:'1031'})).status,401);
  assert.equal((await c('/api/login',{password:'5928'})).status,200);
  assert.equal((await c('/api/recovery-login',{code:'Recovery1234'})).status,200);
  assert.ok(!JSON.stringify(app.locals.db.prepare('SELECT * FROM host_credentials').all()).includes('5928'));
 }finally{app?.locals.db.close();rmSync(dir,{recursive:true,force:true});}
});
