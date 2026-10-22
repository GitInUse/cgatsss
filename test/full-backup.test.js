import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Open} from 'unzipper';
import archiver from 'archiver';
import {createWriteStream} from 'node:fs';
import {pipeline} from 'node:stream/promises';
import {DatabaseSync} from 'node:sqlite';
import {createApp,databaseBackup} from '../server.js';
import {fullBackup} from '../scripts/full-backup.js';
import {restoreFull} from '../scripts/restore-full.js';

test('full backup preserves database state/photos and restores without touching an existing directory',async()=>{
 // This Windows sandbox permits renames inside the workspace, not its virtual
 // Temp directory. Linux CI still exercises the normal temporary filesystem.
 const base=process.platform==='win32'?path.resolve('test-results'):tmpdir();mkdirSync(base,{recursive:true});
 const root=mkdtempSync(path.join(base,'party-full-roundtrip-')),dir=path.join(root,'data');
 const options={dataDir:dir,localPreview:true,production:false,recoveryCode:'test-backup-recovery'};
 const app=createApp(options);let restored;
 try{
  const db=app.locals.db,settings=JSON.stringify({timezone:'America/Chicago',categories:['Best'],override:'closed'});
  db.prepare('INSERT INTO contests VALUES (?,?,?,1,?)').run('old','Old party',settings,'2026-10-01');
  db.prepare('INSERT INTO contests VALUES (?,?,?,0,?)').run('next','Next party',settings,'2026-10-02');
  db.prepare('INSERT INTO party_transitions VALUES (?,?,0)').run('next','old');db.prepare('INSERT INTO party_start_requests VALUES (?,?)').run('request-1','next');
  const filename='12345678-1234-1234-1234-123456789abc.jpg';writeFileSync(path.join(dir,'photos',filename),Buffer.from('immutable test photo'));
  db.prepare('INSERT INTO entries VALUES (?,?,?,?,?,?,?,0,?)').run('entry','old','Winner','Best','',filename,'owner','2026-10-01');
  db.prepare('INSERT INTO votes VALUES (?,?,?,?)').run('old','Best','voter','entry');db.prepare('INSERT INTO messages VALUES (?,?,?,?,0,?)').run('message','old','Guest','Boo','2026-10-01');
  db.prepare('INSERT INTO winners VALUES (?,?,?,?)').run('old','Best','entry','2026-10-01');
  db.prepare('INSERT INTO visitors VALUES (?,?,?)').run('visitor-hash','csrf-value',Date.now());
  db.prepare('INSERT INTO host_credentials VALUES (1,?,?)').run('saved-salt','saved-hash');
  db.prepare('INSERT INTO sessions VALUES (?,?)').run('session-hash',Date.now()+3600000);
  const zip=path.join(root,'full.zip');assert.equal((await fullBackup(dir,zip)).photos,1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n,1,'Backing up must not log out the live host');
  const backupBytes=readFileSync(zip);await assert.rejects(fullBackup(dir,zip),/already exists/);assert.deepEqual(readFileSync(zip),backupBytes);
  const target=path.join(root,'restored');assert.equal((await restoreFull(zip,target)).photos,1);
  const copy=new DatabaseSync(path.join(target,'party.sqlite'),{readOnly:true});
  for(const table of ['contests','entries','votes','messages','winners','visitors','sessions','host_credentials','party_transitions','party_start_requests'])assert.deepEqual(copy.prepare(`SELECT * FROM ${table}`).all(),db.prepare(`SELECT * FROM ${table}`).all(),table);
  copy.close();assert.deepEqual(readFileSync(path.join(target,'photos',filename)),readFileSync(path.join(dir,'photos',filename)));
  const sentinel=path.join(target,'keep.txt');writeFileSync(sentinel,'keep existing data');await assert.rejects(restoreFull(zip,target),/must not exist/);assert.equal(readFileSync(sentinel,'utf8'),'keep existing data');
  // Remove the deliberately fake saved hash from the test copy before starting it.
  const editable=new DatabaseSync(path.join(target,'party.sqlite'));editable.prepare('DELETE FROM host_credentials').run();editable.close();
  restored=createApp({...options,dataDir:target});assert.equal(restored.locals.db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n,0);
  assert.equal(restored.locals.db.prepare('SELECT previous_id FROM party_transitions').get().previous_id,'old');
  await databaseBackup(db,dir,Date.parse('2026-10-21T12:00Z'));
  assert.equal(existsSync(path.join(dir,'backups','2026-10-21.sqlite')),true);
  const missing=path.join(root,'missing-restore');const source=await Open.file(zip),manifestEntry=source.files.find(e=>e.path==='manifest.json');
  const manifest=JSON.parse((await manifestEntry.buffer()).toString());manifest.files.find(e=>e.path.startsWith('photos/')).sha256='0'.repeat(64);
  const corrupt=path.join(root,'bad.zip'),zipper=archiver('zip'),writing=pipeline(zipper,createWriteStream(corrupt));
  for(const entry of source.files)zipper.append(entry.path==='manifest.json'?JSON.stringify(manifest):await entry.buffer(),{name:entry.path});
  await Promise.all([writing,zipper.finalize()]);await assert.rejects(restoreFull(corrupt,missing),/checksum failed/);assert.equal(existsSync(missing),false);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM entries').get().n,1);
 }finally{app.locals.db.close();restored?.locals.db.close();rmSync(root,{recursive:true,force:true});}
});
