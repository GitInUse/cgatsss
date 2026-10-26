import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const normalize=value=>value.replace(/\r\n/g,'\n').trimEnd()+'\n';
const assets={
 'controller.js':normalize(readFileSync(path.join(root,'public/party/camera-controller.js'),'utf8')),
 'app.js':normalize(readFileSync(path.join(root,'public/party/photobooth-demo.js'),'utf8')),
 'style.css':normalize(readFileSync(path.join(root,'public/party/photobooth-demo.css'),'utf8')+'\n'+readFileSync(path.join(root,'public/party/camera-widget.css'),'utf8'))
};
for(const [name,content]of Object.entries(assets)){
 const target=path.join(root,'landing/public/photobooth',name);
 if(process.argv.includes('--check')){if(normalize(readFileSync(target,'utf8'))!==content)throw Error('Shared photo booth assets are stale. Run node scripts/sync-photobooth.js.');}
 else{mkdirSync(path.dirname(target),{recursive:true});writeFileSync(target,content);}
}
console.log('Shared photo booth assets are '+(process.argv.includes('--check')?'in sync.':'generated.'));
