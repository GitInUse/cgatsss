import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseFeed,mergeDeals,scanDeals,FEED_KEY,httpsUrl} from './deal-store.js';
import {validSubscription,preferences,eligible,vapidKeys,saveSubscription,notifyDeals,testPush} from './deal-push.js';
import {dealApi} from './deal-api.js';
const now=Date.now();
function memory(){const data=new Map();return {data,NO_MEMES:{async get(k,type){const v=data.get(k);return v?(type==='json'?JSON.parse(v):v):null;},async put(k,v){data.set(k,v);},async delete(k){data.delete(k);},async list({prefix,limit=1000}){const keys=[...data.keys()].filter(k=>k.startsWith(prefix));return {keys:keys.slice(0,limit).map(name=>({name})),list_complete:keys.length<=limit};}},LOGIN_LIMITER:{async limit(){return {success:true};}}};}
function xml(title='DeWalt drill $99',id=12){return `<?xml version="1.0"?><rss><channel><title>Test feed</title><item><title><![CDATA[${title}]]></title><link>https://slickdeals.net/f/${id}-test</link><description>Reported offer</description><pubDate>${new Date(now).toUTCString()}</pubDate><content:encoded><![CDATA[<img src="https://static.slickdealscdn.com/test.jpg"><a href="https://slickdeals.net/click?test=1" data-product-exitWebsite="amazon.com" data-aps-asin="B012345678">Amazon</a> code <span data-couponid='123'><strong>TESTONLY</strong></span>]]></content:encoded></item></channel></rss>`;}
const base=()=>parseFeed(xml(),now)[0];
const b64=bytes=>Buffer.from(bytes).toString('base64url');
async function subscription(){const keys=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);return {endpoint:'https://fcm.googleapis.com/fcm/send/test-only',expirationTime:null,keys:{p256dh:b64(await crypto.subtle.exportKey('raw',keys.publicKey)),auth:b64(crypto.getRandomValues(new Uint8Array(16)))}};}
test('RSS normalization keeps evidence, images, retailer links and no invented savings or stars',()=>{
 const d=base();assert.equal(d.category,'tools');assert.equal(d.priceValue,99);assert.equal(d.url,'https://www.amazon.com/dp/B012345678');assert.equal(d.typicalPrice,'');assert.equal(d.discount,'');assert.equal(d.rating,undefined);assert.equal(d.status,'reported');assert.match(d.conditions,/Code: TESTONLY/);assert.equal(d.imageUrl,'https://static.slickdealscdn.com/test.jpg');
 assert.equal(parseFeed(xml('Pokémon ETB drawing $99'),now)[0].drawing,true);
 assert.equal(parseFeed(xml('SSD possible price glitch $10'),now)[0].glitch,true);
 assert.equal(parseFeed(xml('Sale $10 or $20'),now)[0].priceValue,null);
 assert.equal(parseFeed(xml().replace(/<img[^>]+>/,''),now)[0].imageUrl,'');
 assert.equal(parseFeed(xml().replace(new Date(now).toUTCString(),new Date(now-2*86400000).toUTCString()),now).length,0);
 assert.throws(()=>parseFeed('<!DOCTYPE rss [<!ENTITY x "bad">]><rss/>',now));
 assert.equal(httpsUrl('https://user:password@example.test/'),'');
});
test('deduplication preserves discovery and price history without inventing normal prices',()=>{
 const first=mergeDeals([],[base(),base()],now);assert.equal(first.length,1);assert.equal(first[0].priceHistory.length,1);
 const second=mergeDeals(first,[base()],now+1000);assert.equal(second[0].priceHistory.length,1);assert.equal(second[0].firstDiscoveredAt,first[0].firstDiscoveredAt);
 const lower=mergeDeals(second,[{...base(),priceValue:70,price:'$70'}],now+2000);assert.equal(lower[0].priceHistory.length,2);assert.equal(lower[0].typicalPrice,'');
 assert.equal(mergeDeals(lower,[],now+3000)[0].status,'stale');
});
test('scanner stores real feed results, reports errors and preserves saved offers during outages',async()=>{
 const env=memory();const ok=await scanDeals(env,{now,fetcher:async()=>new Response(xml())});assert.equal(ok.deals.length,1);assert.equal(ok.sources.length,2);
 const failed=await scanDeals(env,{now:now+1000,fetcher:async()=>new Response('error',{status:503})});assert.equal(failed.lastSuccessAt,ok.lastSuccessAt);assert.equal(failed.sources[0].status,'error');assert.equal(failed.deals[0].status,'reported');
 const invalid=await scanDeals(env,{now:now+2000,fetcher:async()=>new Response('<html>blocked</html>')});assert.ok(invalid.sources.every(s=>s.status==='error'));assert.equal(JSON.parse(env.data.get(FEED_KEY)).deals.length,1);
});
test('push validates endpoints and preferences, signs encrypted payloads and deduplicates alerts',async()=>{
 const env=memory(),sub=await subscription();assert.equal(validSubscription(sub),true);assert.equal(validSubscription({...sub,endpoint:'https://localhost/private'}),false);assert.equal(validSubscription({...sub,endpoint:'https://fcm.googleapis.com.evil.test/push'}),false);
 assert.equal(eligible({...base(),priority:'great'},preferences({categories:[]})),false);assert.equal(eligible({...base(),glitch:true},preferences({glitches:false})),false);assert.equal(eligible(base(),preferences({urgentOnly:true})),false);
 const keys=await vapidKeys(env,{create:true});assert.equal(keys.publicKey.length,87);assert.deepEqual(await vapidKeys(env,{create:true}),keys);
 await saveSubscription(env,sub,preferences());
 const deal={...base(),priority:'great',publishedAt:new Date(now+10000).toISOString(),lastCheckedAt:new Date(now+10000).toISOString()};let calls=0;
 const fetcher=async(url,options)=>{calls++;assert.equal(url,sub.endpoint);assert.equal(options.headers['content-encoding'],'aes128gcm');assert.match(options.headers.authorization,/^vapid /);assert.equal(options.body.byteLength,4096);return new Response(null,{status:201});};
 const catalog={deals:[deal]};assert.equal((await notifyDeals(env,catalog,{now:now+11000,fetcher})).sent,1);
 assert.equal((await notifyDeals(env,catalog,{now:now+12000,fetcher})).sent,0);assert.equal(calls,1);
 catalog.deals[0]={...deal,priceValue:80};assert.equal((await notifyDeals(env,catalog,{now:now+13000,fetcher})).sent,1);
 assert.equal(await testPush(env,sub,fetcher),201);
 catalog.deals[0]={...deal,priceValue:50};assert.equal((await notifyDeals(env,catalog,{now:now+14000,fetcher:async()=>new Response(null,{status:410})})).removed,1);
 assert.equal((await env.NO_MEMES.list({prefix:'deal-hunter:push:v1:'})).keys.length,0);
});
test('private mutation endpoints reject anonymous, cross-site, oversized and invalid subscriptions',async()=>{
 const env=memory();const options={json:(body,status=200)=>Response.json(body,{status}),personalSession:async()=>true,now:()=>now};
 const req=(body='{}',origin='https://idontthinkiwill.com')=>new Request('https://idontthinkiwill.com/api/personal/deals/subscribe',{method:'POST',headers:{Origin:origin,'X-Personal-Action':'1'},body});
 assert.equal((await dealApi(req(),env,{...options,personalSession:async()=>false})).status,401);
 assert.equal((await dealApi(req('{}','https://evil.test'),env,options)).status,403);
 assert.equal((await dealApi(req('x'.repeat(9000)),env,options)).status,413);
 await vapidKeys(env,{create:true});assert.equal((await dealApi(req('{"subscription":{"endpoint":"https://localhost/"}}'),env,options)).status,400);
});
