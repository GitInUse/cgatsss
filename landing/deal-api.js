import {FEED_KEY,scanDeals,httpsUrl} from './deal-store.js';
import {vapidKeys,saveSubscription,removeSubscription,testPush,notifyDeals} from './deal-push.js';
export async function dealApi(request,env,{json,personalSession,fetcher=fetch,now=()=>Date.now()}){
 const path=new URL(request.url).pathname;
 if(!path.startsWith('/api/personal/deals'))return null;
 if(!await personalSession(request,env))return json({error:'Sign in required.'},401);
 if(request.method==='GET'&&path==='/api/personal/deals'){
  const catalog=await env.NO_MEMES.get(FEED_KEY,'json');
  const keys=await vapidKeys(env);
  return json({deals:(Array.isArray(catalog?.deals)?catalog.deals:[]).filter(d=>d&&/^sd-\d+$/.test(d.id)&&typeof d.name==='string'&&httpsUrl(d.url)).map(d=>Object.fromEntries(['id','productId','name','description','price','priceValue','imageUrl','retailer','category','openbox','glitch','drawing','url','directRetailer','sourceUrl','source','conditions','status','publishedAt','lastCheckedAt','availability','priority','firstDiscoveredAt','priceHistory'].map(key=>[key,key==='status'&&now()-Date.parse(d.lastCheckedAt)>86400000?'stale':d[key]]))),sources:catalog?.sources||[],lastAttemptAt:catalog?.lastAttemptAt||null,lastSuccessAt:catalog?.lastSuccessAt||null,pushPublicKey:keys?.publicKey||null,coverage:{community:'Slickdeals Frontpage and Pokémon RSS',historical:'Keepa API not configured',localOpenBox:'Local inventory for 60193 and 60107 is not connected',directMonitoring:'Retailer APIs, Walmart drawings, and Target release monitoring are not connected'}});
 }
 if(request.method!=='POST')return json({error:'Not found.'},404);
 if(request.headers.get('Origin')!==new URL(request.url).origin||request.headers.get('X-Personal-Action')!=='1')return json({error:'Refresh this page and try again.'},403);
 if(!await env.LOGIN_LIMITER.limit({key:'deal-actions'}).then(r=>r.success))return json({error:'Please wait a minute before trying again.'},429);
 try{
  if(path==='/api/personal/deals/scan'){
   const catalog=await env.NO_MEMES.get(FEED_KEY,'json');
   if(catalog?.lastAttemptAt&&now()-Date.parse(catalog.lastAttemptAt)<300000)return json({error:'Sources were checked recently. Try again in five minutes.'},429);
   const fresh=await scanDeals(env,{fetcher,now:now()});
   await notifyDeals(env,fresh,{fetcher,now:now()});
   return json({ok:fresh.sources.some(s=>s.status==='ok'),sources:fresh.sources});
  }
  // Bound JSON body even for chunked requests.
  const reader=request.body?.getReader();let size=0,body='';const decoder=new TextDecoder();
  if(reader)for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>8192){await reader.cancel();return json({error:'Request too large.'},413);}body+=decoder.decode(value,{stream:true});}
  body+=decoder.decode();const value=JSON.parse(body||'{}');
  if(path==='/api/personal/deals/subscribe'){
   if(!await vapidKeys(env))return json({error:'Run a source check before enabling push.'},503);
   await saveSubscription(env,value.subscription,value.preferences);return json({ok:true});
  }
  if(path==='/api/personal/deals/unsubscribe'){await removeSubscription(env,value.endpoint);return json({ok:true});}
  if(path==='/api/personal/deals/test-push'){await testPush(env,value.subscription,fetcher);return json({ok:true});}
  return json({error:'Not found.'},404);
 }catch(error){return json({error:/Invalid browser|Device limit|Enable notifications|Push service|Push setup/.test(error.message)?error.message:'The action could not be completed. Try again.'},400);}
}
export async function scheduledDeals(env){
 const catalog=await scanDeals(env);
 await notifyDeals(env,catalog);
 if(catalog.sources.every(s=>s.status==='error'))throw Error('All deal sources unavailable');
}
