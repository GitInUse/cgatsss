'use strict';
const root=document.getElementById('deals'),summary=document.getElementById('summary'),pushStatus=document.getElementById('push-status');
let deals=[],selected='all',feed={},registration;
function node(tag,cls,value){const el=document.createElement(tag);el.className=cls;el.textContent=value;return el;}
function safeUrl(value){try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password?url.href:'';}catch{return '';}}
function link(value,title){const el=node('a','',title);el.href=safeUrl(value);el.target='_blank';el.rel='noopener noreferrer';return el;}
function show(){
 root.replaceChildren();
 const shown=deals.filter(d=>d.status!=='stale'&&(selected==='all'||selected==='amazon'&&d.retailer==='Amazon'||selected==='glitch'&&d.glitch||selected==='openbox'&&d.openbox||d.category===selected));
 summary.textContent=shown.length+' reported offer'+(shown.length===1?'':'s')+' · checkout unverified';
 if(!shown.length){root.append(node('p','empty',deals.length?'No current reports in this category.':'No current offers saved. Check source status above.'));return;}
 for(const deal of shown){
  const card=node('article','deal','');card.id=deal.id;
  const thumb=node('div','thumb fallback','🏷️');
  if(safeUrl(deal.imageUrl)){const img=document.createElement('img');img.src=deal.imageUrl;img.alt='';img.loading='lazy';img.referrerPolicy='no-referrer';img.width=76;img.height=76;img.addEventListener('error',()=>img.remove(),{once:true});thumb.append(img);}
  const detail=node('div','details','');
  detail.append(node('p','retailer',deal.retailer+(deal.drawing?' · Drawing / chance to purchase':' · Checkout unverified')),node('h2','name',deal.name));
  if(deal.description)detail.append(node('p','desc',deal.description));
  if(deal.ratingVerified&&Number.isFinite(deal.rating)&&Number.isInteger(deal.reviewCount))detail.append(node('p','fine','★ '+deal.rating+' · '+deal.reviewCount+' reviews'));
  const prices=node('div','price','');prices.append(node('strong','',deal.price||'Price not reported'));
  // Only show savings when an upstream adapter supplies a verified recent-price basis.
  if(deal.typicalPriceVerified&&Number.isFinite(deal.typicalPriceValue)&&Number.isFinite(deal.priceValue)&&deal.typicalPriceValue>deal.priceValue){prices.append(node('del','old','$'+deal.typicalPriceValue.toFixed(2)),node('span','badge',Math.floor((1-deal.priceValue/deal.typicalPriceValue)*100)+'% OFF'));}
  detail.append(prices);if(deal.glitch)detail.append(node('p','verification','Possible price glitch. Orders may be canceled.'));
  if(deal.conditions)detail.append(node('p','fine',deal.conditions));
  const time=Date.parse(deal.lastCheckedAt);if(Number.isFinite(time))card.title='Source checked '+new Date(time).toLocaleString();
  const links=node('div','deal-links','');if(safeUrl(deal.url))links.append(link(deal.url,deal.directRetailer?'View on '+deal.retailer:'Shop offer via Slickdeals'));
  if(safeUrl(deal.sourceUrl))links.append(link(deal.sourceUrl,'Slickdeals report ↗'));
  detail.append(links);card.append(thumb,detail);root.append(card);
 }
 const id=location.hash.slice(1);if(id&&/^sd-\d+$/.test(id))document.getElementById(id)?.scrollIntoView({block:'center'});
}
async function api(path,body){const response=await fetch('/api/personal/deals'+path,{method:'POST',headers:{'Content-Type':'application/json','X-Personal-Action':'1'},body:JSON.stringify(body||{})});if(response.status===401){location.assign('/login?next=%2Fdeals');throw Error('Sign in again.');}const value=await response.json();if(!response.ok)throw Error(value.error||'Action failed');return value;}
async function load(){
 const button=document.getElementById('refresh');button.disabled=true;
 try{
  const response=await fetch('/api/personal/deals',{cache:'no-store'});if(response.status===401){location.assign('/login?next=%2Fdeals');return;}if(!response.ok)throw Error('Feed unavailable');
  feed=await response.json();deals=Array.isArray(feed.deals)?feed.deals:[];show();
  const errors=(feed.sources||[]).filter(s=>s.status!=='ok');
  document.getElementById('feed-status').textContent=!feed.lastSuccessAt?'Sources have not completed a successful check yet.':(errors.length?'Source errors: '+errors.map(s=>s.id).join(', ')+'. Showing saved reports. ':'')+'Last successful source check: '+new Date(feed.lastSuccessAt).toLocaleString()+'.';
 }catch(error){summary.textContent='Feed unavailable';root.replaceChildren(node('p','empty',error.message));}finally{button.disabled=false;}
}
function prefs(){return {enabled:true,categories:[...document.querySelectorAll('input[name="category"]:checked')].map(el=>el.value),glitches:document.getElementById('glitches').checked,pokemon:document.getElementById('pokemon-alerts').checked,urgentOnly:document.getElementById('urgent-only').checked};}
function restorePrefs(){try{const p=JSON.parse(localStorage.getItem('deal-hunter-preferences'));if(!p)return;document.querySelectorAll('input[name="category"]').forEach(el=>el.checked=p.categories.includes(el.value));document.getElementById('glitches').checked=p.glitches;document.getElementById('pokemon-alerts').checked=p.pokemon;document.getElementById('urgent-only').checked=p.urgentOnly;}catch{}}
function rememberPrefs(p){try{localStorage.setItem('deal-hunter-preferences',JSON.stringify(p));}catch{}}
async function worker(){if(!('serviceWorker'in navigator)||!('PushManager'in window))throw Error('This browser does not support Web Push. Use Chrome on Android.');registration=await navigator.serviceWorker.register('/deals-sw.js',{scope:'/deals'});return navigator.serviceWorker.ready;}
async function savePush(subscription){const p=prefs();await api('/subscribe',{subscription:subscription.toJSON(),preferences:p});rememberPrefs(p);}
function action(id,fn){document.getElementById(id).addEventListener('click',async()=>{try{await fn();}catch(error){pushStatus.textContent=error.message;}});}
restorePrefs();
if('serviceWorker'in navigator)worker().then(()=>pushStatus.textContent='Notifications are opt-in. Enable them on your Samsung in Chrome.').catch(error=>pushStatus.textContent=error.message);
function bytes(value){return Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/').padEnd(Math.ceil(value.length/4)*4,'=')),c=>c.charCodeAt(0));}
action('enable-push',async()=>{
 if(!feed.pushPublicKey)throw Error('Run “Check sources now” first, then refresh after a minute.');
 const permission=await Notification.requestPermission();if(permission!=='granted')throw Error('Notifications are blocked. Allow them in Chrome’s site settings.');
 const ready=await worker();let subscription=await ready.pushManager.getSubscription();
 if(!subscription)subscription=await ready.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:bytes(feed.pushPublicKey)});
 await savePush(subscription);pushStatus.textContent='Notifications enabled on this device. Send a test to verify delivery.';
});
action('test-push',async()=>{const ready=await worker(),subscription=await ready.pushManager.getSubscription();if(!subscription)throw Error('Enable notifications first.');await api('/test-push',{subscription:subscription.toJSON()});pushStatus.textContent='Push service accepted the test. Check this device’s notification tray.';});
action('disable-push',async()=>{const ready=await worker(),subscription=await ready.pushManager.getSubscription();if(subscription){await api('/unsubscribe',{endpoint:subscription.endpoint});await subscription.unsubscribe();}pushStatus.textContent='Notifications disabled on this device.';});
document.getElementById('push-settings').addEventListener('submit',async event=>{event.preventDefault();try{const p=prefs();rememberPrefs(p);const ready=await worker(),subscription=await ready.pushManager.getSubscription();if(subscription)await savePush(subscription);pushStatus.textContent=subscription?'Notification settings saved.':'Settings saved on this browser. Enable notifications to subscribe.';}catch(error){pushStatus.textContent=error.message;}});
document.getElementById('scan').addEventListener('click',async()=>{const button=document.getElementById('scan');button.disabled=true;try{const result=await api('/scan');await load();if(!result.ok)document.getElementById('feed-status').textContent='Source checks failed. No new offers were verified.';}catch(error){document.getElementById('feed-status').textContent=error.message;}finally{button.disabled=false;}});
document.querySelectorAll('.filter').forEach(button=>button.addEventListener('click',()=>{selected=button.dataset.filter;document.querySelectorAll('.filter').forEach(el=>{el.classList.toggle('active',el===button);el.setAttribute('aria-pressed',String(el===button));});show();}));
document.getElementById('refresh').addEventListener('click',load);load();
