// Validation-only production build: never opens the live database or writes uploads.
import {readFileSync,readdirSync,statSync,existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
process.chdir(root);
if(Number(process.versions.node.split('.')[0])!==24)throw new Error('Build with the pinned Node 24 runtime.');
function run(args){const result=spawnSync(process.execPath,args,{cwd:root,stdio:'inherit'});if(result.error)throw result.error;if(result.status!==0)process.exit(result.status||1);}
function files(dir){return readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(dir,e.name)):[path.join(dir,e.name)]);}
for(const name of ['server.js',...files('scripts'),...files('public')].filter(f=>f.endsWith('.js')))run(['--check',name]);
run(['scripts/restore-layout.js','--check']);
if(existsSync('landing/package.json'))run(['scripts/sync-photobooth.js','--check']);
await import('../server.js'); // Validate Express, Sharp and SQLite runtime dependencies without starting the app.
const publicRoot=path.join(root,'public');
for(const name of files(publicRoot)){
  if(/(?:^|[\\/])\.|\.(?:sqlite(?:-wal|-shm)?|zip|key|pem|log)$/i.test(path.relative(publicRoot,name)))throw new Error('Private file found in public assets.');
  if(!name.endsWith('.html'))continue;
  const html=readFileSync(name,'utf8');
  for(const match of html.matchAll(/(?:href|src)="(\/[^"#]*)"/g)){
    const url=match[1].split('?')[0];if(url.startsWith('/api/'))continue;
    const target=path.join(publicRoot,url.endsWith('/')?`${url}index.html`:url);
    if(!existsSync(target)||!statSync(target).isFile())throw new Error(`Missing public asset: ${url}`);
  }
}
run(['scripts/check-release.js']);
console.log('Production build passed. Serves public/ and the existing Express API; no database or upload directory was modified.');
