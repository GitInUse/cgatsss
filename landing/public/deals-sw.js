self.addEventListener('install',event=>{self.skipWaiting();});
self.addEventListener('activate',event=>{event.waitUntil(self.clients.claim());});
// No fetch handler: never cache private HTML, offers, or authenticated API data.
self.addEventListener('push',event=>{
 let data={};try{data=event.data?.json()||{};}catch{}
 const url=typeof data.url==='string'&&/^\/deals(?:#sd-\d+)?$/.test(data.url)?data.url:'/deals';
 event.waitUntil(self.registration.showNotification(String(data.title||'Deal Hunter').slice(0,100),{body:String(data.body||'Open Deal Hunter for details.').slice(0,200),icon:'/deal-icon-192.png',badge:'/deal-icon-192.png',tag:String(data.tag||'deal-hunter').slice(0,100),data:{url}}));
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();const url=new URL(event.notification.data?.url||'/deals',self.location.origin).href;
 event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(async windows=>{for(const client of windows)if(new URL(client.url).pathname==='/deals'){await client.navigate(url);return client.focus();}return self.clients.openWindow(url);}));
});
