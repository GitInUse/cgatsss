import {execFileSync} from 'node:child_process';
import {existsSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const candidates=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean);
const secrets=[process.env.HOST_PASSWORD,process.env.HOST_RECOVERY_CODE,process.env.GOOGLE_CLIENT_SECRET].filter(v=>v&&v.length>=8);
const privateRecovery=path.join(root,'test-results','host-recovery-code.txt');
if(existsSync(privateRecovery))secrets.push(readFileSync(privateRecovery,'utf8').trim());
const problems=[];
for(const name of new Set(candidates)){
  const file=path.join(root,name);if(!existsSync(file))continue;
  if(/^(?:data|test-results|backups|uploads|node_modules|\.pnpm-store)\//.test(name)||/(?:^|\/)\.env(?!\.example$)|\.(?:sqlite(?:-wal|-shm)?|zip|key|pem|log)$/i.test(name))problems.push(name);
  if(!/\.(?:js|json|ya?ml|md|html|css|cmd|example)$/.test(name))continue;
  const text=readFileSync(file,'utf8');
  if(secrets.some(value=>value.length>=8&&text.includes(value))||/\b(?:github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{30,})\b|GOCSPX-[A-Za-z0-9_-]{10,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text))problems.push(name);
}
if(problems.length)throw new Error(`Release check failed; remove private content from: ${[...new Set(problems)].join(', ')}`);
console.log('Release check passed: private storage paths and known local host secrets are excluded.');
