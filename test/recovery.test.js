import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../server.js';
import { request } from './transport.js';

test('recovery survives PIN changes and is separate from normal login throttling',async()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'party-recovery-')),code='TestR9876';
  try{
    for(const password of ['1031','9876']){
      const app=createApp({dataDir:dir,localPreview:true,production:false,password,recoveryCode:code});
      try{
        const origin='http://party.test',cookies=new Map();
        const stateResponse=await request(app,origin+'/api/state');
        const state=JSON.parse(Buffer.from(await stateResponse.arrayBuffer()).toString());
        for(const cookie of stateResponse.headers.getSetCookie()){const[k,v]=cookie.split(';')[0].split('=');cookies.set(k,v);}
        const call=async(url,body)=>{
          const res=await request(app,origin+url,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-CSRF-Token':state.csrf,Cookie:[...cookies].map(([k,v])=>`${k}=${v}`).join('; ')},body:JSON.stringify(body)});
          for(const cookie of res.headers.getSetCookie()){const[k,v]=cookie.split(';')[0].split('=');cookies.set(k,v);}
          return res;
        };
        for(let i=0;i<8;i++)assert.equal((await call('/api/login',{password:'wrong'})).status,401);
        assert.equal((await call('/api/login',{password})).status,429);
        assert.equal((await call('/api/recovery-login',{code:'wrong'})).status,401);
        assert.equal((await call('/api/recovery-login',{code})).status,200);
        const protectedPage=await request(app,origin+'/api/host/contests',{headers:{Cookie:[...cookies].map(([k,v])=>`${k}=${v}`).join('; ')}});
        assert.equal(protectedPage.status,200);
        const publicState=await request(app,origin+'/api/state');
        assert.ok(!Buffer.from(await publicState.arrayBuffer()).toString().includes(code));
      }finally{app.locals.db.close();}
    }
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('recovery file changes take effect immediately in both unlock modes',async()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'party-recovery-file-')),file=path.join(dir,'private-code.txt');
  writeFileSync(file,'TestR1234\n');
  const app=createApp({dataDir:dir,localPreview:true,production:false,recoveryCodeFile:file,testing:true});
  try{
    const origin='http://party.test',res=await request(app,origin+'/api/state');
    const state=JSON.parse(Buffer.from(await res.arrayBuffer()).toString());
    const cookie=res.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
    const login=async(route,value)=>request(app,origin+route,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-CSRF-Token':state.csrf,Cookie:cookie},body:JSON.stringify(route==='/api/login'?{password:value}:{code:value})});
    assert.equal((await login('/api/login','TestR1234')).status,200);
    writeFileSync(file,'TestR9876\n');
    assert.equal((await login('/api/login','TestR1234')).status,401);
    assert.equal((await login('/api/login','TestR9876')).status,200);
    assert.equal((await login('/api/recovery-login','TestR9876')).status,200);
  }finally{app.locals.db.close();rmSync(dir,{recursive:true,force:true});}
});
