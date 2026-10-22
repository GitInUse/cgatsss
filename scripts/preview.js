import { createApp } from '../server.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const privateDir=path.join(root,'test-results');mkdirSync(privateDir,{recursive:true});
const recoveryFile=path.join(privateDir,'host-recovery-code.txt');
if(!existsSync(recoveryFile))writeFileSync(recoveryFile,`Halloween-${randomBytes(12).toString('hex')}\n`,{flag:'wx',mode:0o600});
const app=createApp({localPreview:true,production:false,dataDir:path.join(root,'test-results','preview'),recoveryCodeFile:recoveryFile});
const server=app.listen(3000,'127.0.0.1',()=>{
  const url='http://127.0.0.1:3000/party/';
  console.log(`Local preview: ${url} — default host PIN: 1031`);
  if(process.platform==='win32'&&process.argv.includes('--open')){
    const browser=spawn('explorer.exe',[url],{windowsHide:true,stdio:'ignore'});
    browser.on('error',()=>console.log(`Open ${url} in your browser.`));
    browser.unref();
  }
});
process.on('SIGTERM',()=>server.close(()=>{app.locals.db.close();process.exit(0);}));
