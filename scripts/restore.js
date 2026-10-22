import { Open } from 'unzipper';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { openDatabase } from '../server.js';

// Restore only into a new directory. No existing database or photos are overwritten.
export async function restore(file, target) {
  const destination = path.resolve(target);
  if (existsSync(destination)) throw new Error('Restore destination must not exist. Choose a new empty path.');
  const zip = await Open.file(path.resolve(file));
  const manifest = zip.files.find(f => f.path === 'archive.json');
  if (!manifest || manifest.uncompressedSize > 30 * 1024 * 1024) throw new Error('Missing or oversized archive manifest.');
  const data = JSON.parse((await manifest.buffer()).toString('utf8'));
  if (data.version !== 1 || !data.tables || !['contests','entries','votes','messages','winners'].every(t => Array.isArray(data.tables[t]))) throw new Error('Unsupported archive format.');
  const columns = {
    contests:['id','title','settings','archived','created'],
    entries:['id','contest_id','name','category','caption','photo','owner','hidden','created'],
    votes:['contest_id','category','voter','entry_id'],
    messages:['id','contest_id','author','message','hidden','created'],
    winners:['contest_id','category','entry_id','published']
  };
  const photos = new Set(data.tables.entries.map(e=>e.photo));
  let size = 0;
  for (const name of photos) {
    if (!/^[a-f0-9-]{36}\.jpg$/.test(name)) throw new Error('Unsafe photo filename.');
    const matches = zip.files.filter(f=>f.path===`photos/${name}`);
    if (matches.length !== 1 || matches[0].uncompressedSize > 12*1024*1024) throw new Error('Missing, duplicate, or oversized photo.');
    size += matches[0].uncompressedSize;
  }
  if (size > 2*1024*1024*1024) throw new Error('Archive exceeds the 2 GB restore limit.');
  const staging = destination;
  let db;
  try {
    mkdirSync(staging); db = openDatabase(staging);
    db.exec('BEGIN IMMEDIATE');
    for (const [table, cols] of Object.entries(columns)) {
      const insert = db.prepare(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(()=>'?').join(',')})`);
      for (const row of data.tables[table]) insert.run(...cols.map(col=>row[col]));
    }
    for (const row of data.tables.contests) {
      const settings=JSON.parse(row.settings);
      if (!Array.isArray(settings.categories) || !settings.timezone) throw new Error('Invalid contest settings.');
    }
    db.exec('COMMIT');
    for (const name of photos) writeFileSync(path.join(staging,'photos',name),await zip.files.find(f=>f.path===`photos/${name}`).buffer(),{flag:'wx'});
    db.close(); db=null;
    return { contests:data.tables.contests.length, entries:data.tables.entries.length };
  } catch (e) {
    if(db) db.close();
    // Only this invocation's verified staging directory can be removed.
    rmSync(staging,{recursive:true,force:true}); throw e;
  }
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const [, , file, target]=process.argv;
  if(!file || !target){ console.error('Usage: node scripts/restore.js archive.zip NEW_DATA_DIRECTORY'); process.exitCode=1; }
  else restore(file,target).then(result=>console.log('Restored:',result)).catch(e=>{console.error(e.message);process.exitCode=1;});
}
