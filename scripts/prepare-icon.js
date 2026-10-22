import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const input = process.argv[2];
if (!input) throw new Error('Usage: node scripts/prepare-icon.js TRANSPARENT_PLATE_PNG');
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const output=path.join(root,'public','party','assets');
mkdirSync(output,{recursive:true});
const logo=await sharp(input).trim().resize({width:1024,height:1024,fit:'inside',withoutEnlargement:true}).png({compressionLevel:9}).toBuffer();
await sharp(logo).toFile(path.join(output,'championship-logo.png'));
for (const [filename,size] of [['championship-favicon.png',64],['championship-touch.png',180]]) {
  await sharp(logo).resize(size,size,{fit:'contain',background:{r:0,g:0,b:0,alpha:0}}).png({compressionLevel:9}).toFile(path.join(output,filename));
}
const metadata=await sharp(logo).metadata();
console.log(`Prepared transparent plate logo (${metadata.width}×${metadata.height}) and page icons.`);
