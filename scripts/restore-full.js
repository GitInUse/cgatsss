import {Open} from 'unzipper';
import {mkdirSync,existsSync,createWriteStream,rmSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {assertPrivateTarget,verifySnapshot} from './full-backup.js';

export async function restoreFull(file,destination){
 const target=path.resolve(destination);assertPrivateTarget(target);
 if(existsSync(target))throw new Error('Restore destination must not exist. Existing data will never be overwritten.');
 const zip=await Open.file(path.resolve(file)),manifests=zip.files.filter(e=>e.path==='manifest.json');
 if(manifests.length!==1||manifests[0].uncompressedSize>10*1024*1024)throw new Error('Invalid full-backup manifest.');
 const manifest=JSON.parse((await manifests[0].buffer()).toString('utf8'));
 if(manifest.format!=='party-full-backup'||manifest.version!==1||!Array.isArray(manifest.files))throw new Error('Unsupported full backup. Use scripts/restore.js for the portable photo export.');
 const selected=[],names=new Set();let total=0;
 for(const item of manifest.files){
  if(!item||typeof item.path!=='string'||!(item.path==='party.sqlite'||/^photos\/[a-f0-9-]{36}\.jpg$/.test(item.path))||names.has(item.path))throw new Error('Unsafe or duplicate backup path.');
  names.add(item.path);
  if(!Number.isSafeInteger(item.bytes)||item.bytes<0||item.bytes>(item.path==='party.sqlite'?512*1024*1024:12*1024*1024)||!/^[a-f0-9]{64}$/.test(item.sha256))throw new Error('Invalid backup file metadata.');
  total+=item.bytes;if(total>2*1024*1024*1024)throw new Error('Full backup exceeds the 2 GB restore limit.');
  const entries=zip.files.filter(e=>e.path===item.path);if(entries.length!==1||entries[0].uncompressedSize!==item.bytes)throw new Error('Missing, duplicate, or truncated backup file.');
  selected.push({item,entry:entries[0]});
 }
 if(!names.has('party.sqlite'))throw new Error('Full backup is missing the database.');
 let created=false;
 try{
  mkdirSync(target);created=true;mkdirSync(path.join(target,'photos'));
  for(const{item,entry}of selected){
   const hash=createHash('sha256');let bytes=0;
   const verify=new Transform({transform(chunk,_encoding,callback){bytes+=chunk.length;if(bytes>item.bytes)return callback(new Error('Backup size limit exceeded.'));hash.update(chunk);callback(null,chunk);}});
   await pipeline(entry.stream(),verify,createWriteStream(path.join(target,...item.path.split('/')),{flags:'wx',mode:0o600}));
   if(bytes!==item.bytes||hash.digest('hex')!==item.sha256)throw new Error('Backup checksum failed. The source and existing data were not changed.');
  }
  const photos=verifySnapshot(path.join(target,'party.sqlite'));
  if(photos.some(photo=>!names.has(`photos/${photo}`)))throw new Error('The backup is missing a referenced photo.');
  return{directory:target,photos:photos.length};
 }catch(error){if(created)rmSync(target,{recursive:true,force:true});throw error;}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const[,,file,destination]=process.argv;
 if(!file||!destination){console.error('Usage: node scripts/restore-full.js PRIVATE_BACKUP.zip NEW_DATA_DIR');process.exitCode=1;}
 else restoreFull(file,destination).then(result=>console.log('Restored into new directory:',result)).catch(e=>{console.error(e.message);process.exitCode=1;});
}
