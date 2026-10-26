// Full disaster-recovery backup. Contains private database records/password hashes.
import {DatabaseSync,backup} from 'node:sqlite';
import {createHash,randomUUID} from 'node:crypto';
import {createReadStream,createWriteStream,mkdtempSync,rmSync,existsSync,statSync,unlinkSync} from 'node:fs';
import {pipeline} from 'node:stream/promises';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import archiver from 'archiver';

export function assertPrivateTarget(target){
 const publicDir=fileURLToPath(new URL('../public/',import.meta.url)),relative=path.relative(publicDir,path.resolve(target));
 if(relative===''||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative)))throw new Error('Backup/restore targets must be outside public/.');
}
export function verifySnapshot(file){
 const db=new DatabaseSync(file,{readOnly:true});
 try{
  if(db.prepare('PRAGMA quick_check').get().quick_check!=='ok'||db.prepare('PRAGMA foreign_key_check').all().length)throw new Error('Backup database failed integrity checks.');
  for(const table of ['contests','entries','votes','messages','winners'])if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))throw new Error('Backup database is missing application tables.');
  return db.prepare("SELECT DISTINCT photo FROM entries WHERE photo<>'' ORDER BY photo").all().map(row=>row.photo);
 }finally{db.close();}
}
export async function digestFile(file){
 const hash=createHash('sha256');let bytes=0;
 for await(const chunk of createReadStream(file)){hash.update(chunk);bytes+=chunk.length;}
 return{bytes,sha256:hash.digest('hex')};
}
export async function fullBackup(dataDir,destination){
 const source=path.resolve(dataDir),outputPath=path.resolve(destination);assertPrivateTarget(outputPath);
 if(existsSync(outputPath))throw new Error('Backup destination already exists. Choose a new ZIP filename.');
 const scratch=mkdtempSync(path.join(tmpdir(),'party-full-backup-'));let createdOutput=false;
 try{
  const snapshot=path.join(scratch,'party.sqlite'),sourceDb=new DatabaseSync(path.join(source,'party.sqlite'),{readOnly:true});
  try{await backup(sourceDb,snapshot);}finally{sourceDb.close();}
  const photos=verifySnapshot(snapshot),sources=[{path:'party.sqlite',file:snapshot}];
  for(const photo of photos){
   if(!/^[a-f0-9-]{36}\.jpg$/.test(photo))throw new Error('Unsafe photo filename in database.');
   const file=path.join(source,'photos',photo);if(!existsSync(file)||!statSync(file).isFile())throw new Error('A referenced photo is missing; backup was not created.');
   sources.push({path:`photos/${photo}`,file});
  }
  const files=[];for(const item of sources)files.push({path:item.path,...await digestFile(item.file)});
  const manifest={format:'party-full-backup',version:1,id:randomUUID(),createdAt:new Date().toISOString(),files};
  const output=createWriteStream(outputPath,{flags:'wx',mode:0o600});output.once('open',()=>{createdOutput=true;});
  const zip=archiver('zip',{zlib:{level:6}});const writing=pipeline(zip,output);
  zip.append(JSON.stringify(manifest,null,2),{name:'manifest.json'});
  for(const item of sources)zip.file(item.file,{name:item.path});
  await Promise.all([writing,zip.finalize()]);
  return{file:outputPath,photos:photos.length,bytes:statSync(outputPath).size};
 }catch(error){if(createdOutput&&existsSync(outputPath))unlinkSync(outputPath);throw error;}
 finally{rmSync(scratch,{recursive:true,force:true});}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const[,,dataDir,destination]=process.argv;
 if(!dataDir||!destination){console.error('Usage: node scripts/full-backup.js DATA_DIR NEW_PRIVATE_BACKUP.zip');process.exitCode=1;}
 else fullBackup(dataDir,destination).then(result=>console.log('Private full backup created:',result)).catch(e=>{console.error(e.message);process.exitCode=1;});
}
