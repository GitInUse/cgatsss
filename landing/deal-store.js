import {XMLParser,XMLValidator} from 'fast-xml-parser';
export const FEEDS=[
 {id:'frontpage',url:'https://slickdeals.net/newsearch.php?mode=frontpage&searcharea=deals&searchin=first&rss=1'},
 {id:'pokemon',url:'https://slickdeals.net/newsearch.php?q=pokemon&searcharea=deals&searchin=title&sort=newest&rss=1'}
];
export const CATEGORIES=['electronics','food','tools','pokemon','other'];
export const FEED_KEY='deal-hunter:catalog:v1';
const parser=new XMLParser({ignoreAttributes:false,processEntities:true,parseTagValue:false,htmlEntities:true});
const text=value=>String(value??'').replace(/<[^>]*>/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#0?39;|&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/\s+/g,' ').trim();
export function httpsUrl(value,hosts){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&u.href.length<=3000&&(!hosts||hosts.includes(u.hostname))?u.href:'';}catch{return '';}}
export function categoryOf(value){
 if(/pok[eé]mon|elite trainer|booster (bundle|pack|box)|greninja|sylveon/i.test(value))return 'pokemon';
 if(/dewalt|milwaukee|ryobi|drill|saw\b|ratchet|ladder|tool\b|wrench/i.test(value))return 'tools';
 if(/snack|cheez|grocery|groceries|chocolate|chips|cereal|coffee|protein|candy|cookies|granola/i.test(value))return 'food';
 if(/ssd|laptop|computer|monitor|gaming|nvidia|tablet|headphone|earbud|tv\b|television|refrigerator|printer|bambu|prusa|scooter|appliance|camera|speaker|usb/i.test(value))return 'electronics';
 return 'other';
}
function attribute(html,name){return html.match(new RegExp(name+'=["\x27]([^"\x27]+)["\x27]','i'))?.[1]||'';}
export function parseFeed(xml,now=Date.now()){
 if(xml.length>1500000||/<!DOCTYPE|<!ENTITY/i.test(xml)||XMLValidator.validate(xml)!==true)throw Error('Invalid RSS response');
 const channel=parser.parse(xml)?.rss?.channel;
 if(!channel||!channel.title)throw Error('RSS channel missing');
 const items=channel.item?Array.isArray(channel.item)?channel.item:[channel.item]:[];
 return items.slice(0,80).flatMap(item=>{
  const title=text(item.title),sourceUrl=httpsUrl(text(item.link),['slickdeals.net','www.slickdeals.net']);
  const id=sourceUrl.match(/\/f\/(\d+)/)?.[1],published=Date.parse(item.pubDate);
  if(!id||!title||!Number.isFinite(published)||published>now+300000||now-published>86400000)return [];
  const html=String(item['content:encoded']||''),description=text(item.description);
  const priceText=title.match(/(?:\bfrom\s+)?\$[\d,]+(?:\.\d{1,2})?/i)?.[0]||'';
  const prices=[...title.matchAll(/\$([\d,]+(?:\.\d{1,2})?)/g)];
  const price=prices.length===1?Number(prices[0][1].replaceAll(',','')):null;
  const asin=attribute(html,'data-aps-asin');
  const retailerHost=attribute(html,'data-product-exitWebsite');
  const stores={'amazon.com':'Amazon','bestbuy.com':'Best Buy','homedepot.com':'Home Depot','lowes.com':"Lowe's",'walmart.com':'Walmart','target.com':'Target','costco.com':'Costco','samsclub.com':"Sam's Club",'gamestop.com':'GameStop','pokemoncenter.com':'Pokémon Center','shop.simon.com':'ShopSimon','woot.com':'Woot'};
  const retailer=stores[retailerHost]||text(retailerHost)||'See source';
  const firstLink=html.match(/<a\b[^>]*href=["']([^"']+)["']/i)?.[1]?.replaceAll('&amp;','&')||'';
  const productUrl=retailer==='Amazon'&&/^[A-Z0-9]{10}$/.test(asin)?'https://www.amazon.com/dp/'+asin:httpsUrl(firstLink,['slickdeals.net','www.slickdeals.net',...Object.keys(stores)]);
  const imageUrl=httpsUrl(attribute(html,'src').replaceAll('&amp;','&'),['static.slickdealscdn.com']);
  const score=Number(html.match(/Thumb Score:\s*\+?(\d+)/)?.[1]||0);
  const category=categoryOf(title),glitch=/price (mistake|glitch)|pricing (error|glitch)|possible glitch/i.test(title);
  const drawing=/drawing|raffle|sweepstake|chance to (buy|purchase)|lottery/i.test(title);
  const coupon=text(html.match(/data-couponid=[^>]*>\s*<strong>([^<]+)/i)?.[1]||'').slice(0,40);
  const conditions=[coupon?'Code: '+coupon:'',/subscribe\s*(?:&|and|n)?\s*save/i.test(html)?'Subscribe & Save required':'',/coupon/i.test(html)?'Check coupon requirements':'',/prime/i.test(title+' '+description)?'Prime conditions may apply':''].filter(Boolean).join(' · ');
  return [{id:'sd-'+id,productId:asin||null,name:title.slice(0,180),description:description.slice(0,140),price:priceText||'See offer',priceValue:price,typicalPrice:'',discount:'',imageUrl,retailer,category,openbox:/open[ -]box/i.test(title),glitch,drawing,url:productUrl||sourceUrl,directRetailer:retailer==='Amazon'&&/^[A-Z0-9]{10}$/.test(asin),sourceUrl,source:'Slickdeals',conditions,status:glitch?'possible-glitch':'reported',publishedAt:new Date(published).toISOString(),lastCheckedAt:new Date(now).toISOString(),availability:'Checkout unverified',priority:glitch||drawing?'urgent':category!=='other'&&score>=100?'great':'routine'}];
 });
}
export function mergeDeals(previous,incoming,now=Date.now()){
 const old=new Map((previous||[]).map(d=>[d.id,d])),unique=new Map();
 for(const deal of incoming){
  if(unique.has(deal.id))continue;
  const prior=old.get(deal.id),history=Array.isArray(prior?.priceHistory)?prior.priceHistory.slice(-19):[];
  if(deal.priceValue!==null&&(!history.length||history.at(-1).price!==deal.priceValue))history.push({price:deal.priceValue,at:deal.lastCheckedAt,basis:'community report'});
  unique.set(deal.id,{...deal,firstDiscoveredAt:prior?.firstDiscoveredAt||new Date(now).toISOString(),priceHistory:history});
 }
 for(const deal of old.values())if(!unique.has(deal.id)&&now-Date.parse(deal.firstDiscoveredAt)<7*86400000)unique.set(deal.id,{...deal,status:'stale',availability:'No longer present in latest source feed'});
 return [...unique.values()].sort((a,b)=>(a.status==='stale')-(b.status==='stale')||Date.parse(b.publishedAt)-Date.parse(a.publishedAt)).slice(0,100);
}
export async function scanDeals(env,{fetcher=fetch,now=Date.now()}={}){
 if(!env.NO_MEMES)throw Error('Deal storage unavailable');
 const previous=await env.NO_MEMES.get(FEED_KEY,'json')||{deals:[],sources:[]};
 const sources=[],incoming=[];
 for(const feed of FEEDS){
  try{
   const response=await fetcher(feed.url,{headers:{Accept:'application/rss+xml, application/xml'},redirect:'manual',signal:AbortSignal.timeout(12000)});
   if(!response.ok)throw Error('HTTP '+response.status);
   if(Number(response.headers.get('Content-Length'))>1500000)throw Error('Feed too large');
   const reader=response.body.getReader(),decoder=new TextDecoder();let xml='',size=0;
   for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>1500000){await reader.cancel();throw Error('Feed too large');}xml+=decoder.decode(value,{stream:true});}
   xml+=decoder.decode();const deals=parseFeed(xml,now);incoming.push(...deals);
   sources.push({id:feed.id,status:'ok',count:deals.length,checkedAt:new Date(now).toISOString()});
  }catch(error){sources.push({id:feed.id,status:'error',message:/^HTTP \d+$/.test(error.message)?error.message:'Source unavailable or invalid',checkedAt:new Date(now).toISOString()});}
 }
 const success=sources.some(s=>s.status==='ok');
 // A failed provider never silently expires offers from another provider.
 let deals=success?mergeDeals(previous.deals,incoming,now):previous.deals;
 if(sources.some(s=>s.status==='error')){
  const prior=new Map(previous.deals.map(d=>[d.id,d]));
  deals=deals.map(d=>d.status==='stale'&&prior.has(d.id)?prior.get(d.id):d);
 }
 const catalog={deals,sources,lastAttemptAt:new Date(now).toISOString(),lastSuccessAt:success?new Date(now).toISOString():previous.lastSuccessAt||null};
 await env.NO_MEMES.put(FEED_KEY,JSON.stringify(catalog));
 console.log(JSON.stringify({event:'deal-scan',sources:sources.map(({id,status,count})=>({id,status,count})),deals:deals.length}));
 return catalog;
}
