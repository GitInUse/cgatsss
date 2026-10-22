import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createApp} from '../server.js';
import {request} from './transport.js';
test('free sample explicitly allows temporary storage while preserving production authentication',async()=>{
 const saved=Object.fromEntries(['RENDER','DEMO_MODE','REQUIRE_PERSISTENT_DISK'].map(k=>[k,process.env[k]]));
 const dir=mkdtempSync(path.join(tmpdir(),'party-demo-'));
 const options={dataDir:dir,production:true,password:'sample-test-password',recoveryCode:'sample-test-recovery',origin:'https://sample.onrender.com',testing:true};
 let app;
 try{
  process.env.RENDER='true';delete process.env.DEMO_MODE;process.env.REQUIRE_PERSISTENT_DISK='false';
  assert.throws(()=>createApp(options),/Persistent disk/);
  process.env.DEMO_MODE='true';app=createApp(options);
  const stateResponse=await request(app,'https://sample.onrender.com/api/state');
  const state=JSON.parse(Buffer.from(await stateResponse.arrayBuffer()).toString());
  assert.equal(state.demoMode,true);assert.equal(state.host,false);assert.equal(state.localPreview,false);
  assert.equal((await request(app,'https://sample.onrender.com/api/host/contests')).status,401);
  assert.equal((await request(app,'https://sample.onrender.com/data/party.sqlite')).status,404);
  process.env.REQUIRE_PERSISTENT_DISK='true';assert.throws(()=>createApp(options),/Persistent disk/);
 }finally{app?.locals.db.close();rmSync(dir,{recursive:true,force:true});for(const [key,value] of Object.entries(saved)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
});
