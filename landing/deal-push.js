import {buildPushPayload} from '@block65/webcrypto-web-push';
import {CATEGORIES} from './deal-store.js';
const KEY='deal-hunter:vapid:v1',PREFIX='deal-hunter:push:v1:';
const b64=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
export const hash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
export async function vapidKeys(env,{create=false}={}){
 let saved=await env.NO_MEMES.get(KEY,'json');
 if(!saved&&create){
  const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
  const jwk=await crypto.subtle.exportKey('jwk',pair.privateKey);
  saved={publicKey:b64(await crypto.subtle.exportKey('raw',pair.publicKey)),privateKey:jwk.d,subject:'https://idontthinkiwill.com'};
  await env.NO_MEMES.put(KEY,JSON.stringify(saved));
 }
 return saved;
}
export function validSubscription(value){
 try{
  const url=new URL(value.endpoint);
  if(url.protocol!=='https:'||url.username||url.password||url.port||url.hash||value.endpoint.length>2000)return false;
  // Prevent private endpoints and arbitrary server-side requests. Browser push services only.
  if(!['fcm.googleapis.com','updates.push.services.mozilla.com','web.push.apple.com'].includes(url.hostname))return false;
  return /^[A-Za-z0-9_-]{87}$/.test(value.keys?.p256dh||'')&&/^[A-Za-z0-9_-]{22}$/.test(value.keys?.auth||'');
 }catch{return false;}
}
export function preferences(value={}){
 return {enabled:value.enabled!==false,categories:Array.isArray(value.categories)?value.categories.filter(c=>CATEGORIES.includes(c)):CATEGORIES,glitches:value.glitches!==false,pokemon:value.pokemon!==false,urgentOnly:value.urgentOnly===true};
}
export function eligible(deal,prefs){
 if(!prefs.enabled||['stale','expired','out-of-stock','unverified'].includes(deal.status)||deal.priority==='routine')return false;
 if(deal.glitch&&!prefs.glitches||deal.category==='pokemon'&&!prefs.pokemon)return false;
 if(!prefs.categories.includes(deal.category))return false;
 return !prefs.urgentOnly||deal.priority==='urgent';
}
export async function saveSubscription(env,subscription,prefs){
 if(!validSubscription(subscription))throw Error('Invalid browser push subscription');
 const id=await hash(subscription.endpoint),key=PREFIX+id;
 const previous=await env.NO_MEMES.get(key,'json');
 if(!previous){const page=await env.NO_MEMES.list({prefix:PREFIX,limit:11});if(page.keys.length>=10||!page.list_complete)throw Error('Device limit reached');}
 await env.NO_MEMES.put(key,JSON.stringify({subscription:{endpoint:subscription.endpoint,keys:subscription.keys,expirationTime:subscription.expirationTime||null},preferences:preferences(prefs),createdAt:previous?.createdAt||new Date().toISOString(),sent:previous?.sent||{},updatedAt:new Date().toISOString()}));
 return id;
}
export async function removeSubscription(env,endpoint){if(typeof endpoint!=='string'||endpoint.length>2000)throw Error('Invalid endpoint');await env.NO_MEMES.delete(PREFIX+await hash(endpoint));}
export async function sendPush(subscription,data,keys,fetcher=fetch){
 if(!validSubscription(subscription))throw Error('Invalid browser push subscription');
 const payload=await buildPushPayload({data,options:{ttl:1800,urgency:'high'}},subscription,keys);
 const response=await fetcher(subscription.endpoint,{...payload,redirect:'manual',signal:AbortSignal.timeout(10000)});
 return response.status;
}
export async function testPush(env,subscription,fetcher=fetch){
 if(!validSubscription(subscription))throw Error('Invalid browser push subscription');
 const saved=await env.NO_MEMES.get(PREFIX+await hash(subscription.endpoint),'json');
 if(!saved)throw Error('Enable notifications on this device first');
 const keys=await vapidKeys(env);if(!keys)throw Error('Push setup pending');
 const status=await sendPush(saved.subscription,{title:'Deal Hunter test',body:'Push delivery is working. Tap to open Deal Hunter.',url:'/deals',tag:'deal-hunter-test'},keys,fetcher);
 if(status===404||status===410)await removeSubscription(env,subscription.endpoint);
 if(status<200||status>=300)throw Error('Push service rejected the test ('+status+')');
 return status;
}
export async function notifyDeals(env,catalog,{fetcher=fetch,now=Date.now()}={}){
 const keys=await vapidKeys(env,{create:true}),page=await env.NO_MEMES.list({prefix:PREFIX,limit:10});
 const result={sent:0,failed:0,removed:0};
 for(const entry of page.keys){
  const device=await env.NO_MEMES.get(entry.name,'json');if(!device||!device.preferences?.enabled)continue;
  const sent=device.sent||{};let changed=false;
  // Bound delivery/subrequests and avoid a notification flood on the first install.
  const candidates=catalog.deals.filter(d=>eligible(d,device.preferences)&&Date.parse(d.publishedAt)>Math.max(Date.parse(device.createdAt),now-3600000)&&Date.parse(d.lastCheckedAt)>now-1800000);
  for(const deal of candidates.filter(d=>!sent[d.id]||(Number.isFinite(d.priceValue)&&Number.isFinite(sent[d.id].price)&&d.priceValue<=sent[d.id].price*.85)).slice(0,1)){
   const prior=sent[deal.id];
   if(prior&&!(Number.isFinite(deal.priceValue)&&Number.isFinite(prior.price)&&deal.priceValue<=prior.price*.85))continue;
   try{
    const status=await sendPush(device.subscription,{title:deal.glitch?'Deal Hunter: Possible Price Glitch':deal.drawing?'Deal Hunter: Drawing reported':'Deal Hunter: Great deal reported',body:deal.name.slice(0,120)+' · '+deal.retailer+' · Checkout unverified',url:'/deals#'+deal.id,tag:deal.id},keys,fetcher);
    if(status===404||status===410){await env.NO_MEMES.delete(entry.name);result.removed++;changed=false;break;}
    if(status<200||status>=300)throw Error('Push rejected');
    sent[deal.id]={price:deal.priceValue,at:new Date(now).toISOString()};changed=true;result.sent++;
   }catch{result.failed++;}
  }
  if(changed){device.sent=Object.fromEntries(Object.entries(sent).slice(-150));await env.NO_MEMES.put(entry.name,JSON.stringify(device));}
 }
 console.log(JSON.stringify({event:'deal-alerts',...result}));
 return result;
}
