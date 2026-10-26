'use strict';
(()=>{
 const $=id=>document.getElementById(id),sections=['register','inbox','verify','welcome'];
 let state=null,csrf='',pendingToken=null,busy=false,revision=0,expiresTimer,signoutUnconfirmed=false;
 const status=message=>{$('status').textContent=message;};
 const show=id=>{for(const key of sections)$(key).hidden=key!==id;};
 function clearPersonal(){show(null);for(const id of ['guest-name','guest-email','edit-name'])$(id).value='';$('inbox-address').textContent='';$('welcome-name').textContent='';$('demo-email-link').removeAttribute('href');pendingToken=null;clearTimeout(expiresTimer);}
 function readLink(){const match=location.hash.match(/^#verify=([a-f0-9]{64})$/);pendingToken=match?.[1]||null;if(location.hash)history.replaceState(null,'',location.pathname);}
 async function api(path,body,method=body?'POST':'GET'){
  const response=await fetch('/api/guest-demo/'+path,{method,credentials:'same-origin',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(20000),headers:body?{'Content-Type':'application/json','X-CSRF-Token':csrf}:{},body:body?JSON.stringify(body):undefined});
  const data=await response.json();if(!response.ok){if(response.status===401){clearPersonal();state=null;}throw new Error(data.error||'Please try again.');}return data;
 }
 function welcome(guest){clearPersonal();state.guest=guest;$('welcome-name').textContent='Welcome, '+guest.displayName+'!';$('edit-name').value=guest.displayName;show('welcome');status('Demo sign-in complete. No real email was verified.');expiresTimer=setTimeout(()=>{clearPersonal();state=null;status('Your demo session ended. Sign in again.');$('retry').hidden=false;},Math.max(0,guest.expires-Date.now()));}
 async function boot(){
  if(signoutUnconfirmed){await finish();return;}
  const current=++revision;clearPersonal();readLink();state=null;$('retry').hidden=true;status('Checking sign-in…');
  try{const result=await api('session');if(current!==revision)return;state=result;csrf=result.csrf||'';$('event-name').textContent=result.event?.title||'No test party is set up yet.';if(!result.event){status('Ask the host to set up a test party first.');return;}if(result.guest){welcome(result.guest);return;}show(pendingToken?'verify':'register');status('');}
  catch(error){if(current!==revision)return;clearPersonal();status(error.message);$('retry').hidden=false;}
 }
 async function run(action){if(busy)return;busy=true;const current=revision;document.querySelectorAll('button').forEach(b=>b.disabled=true);$('retry').hidden=true;try{await action(current);}catch(error){if(current===revision){status(error.message);if(!state)$('retry').hidden=false;}}finally{busy=false;document.querySelectorAll('button').forEach(b=>b.disabled=false);}}
 $('register-form').addEventListener('submit',event=>{event.preventDefault();run(async current=>{const result=await api('start',{eventId:state?.event?.id,displayName:$('guest-name').value,email:$('guest-email').value});if(current!==revision)return;clearPersonal();$('inbox-address').textContent='To: '+result.email;$('demo-email-link').href=result.verificationPath;show('inbox');status('Demo message ready. Nothing was sent.');});});
 $('demo-email-link').addEventListener('click',event=>{event.preventDefault();const match=$('demo-email-link').getAttribute('href')?.match(/#verify=([a-f0-9]{64})$/);if(!match)return;clearPersonal();pendingToken=match[1];show('verify');status('');});
 $('verify-button').addEventListener('click',()=>run(async current=>{const result=await api('verify',{eventId:state?.event?.id,token:pendingToken});if(current===revision)welcome(result.guest);}));
 $('name-form').addEventListener('submit',event=>{event.preventDefault();run(async current=>{const result=await api('me',{displayName:$('edit-name').value},'PUT');if(current!==revision)return;welcome(result.guest);status('Demo display name saved.');});});
 async function finish(){
  if(busy)return;
  ++revision;clearPersonal();state=null;signoutUnconfirmed=true;status('Finishing…');
  await run(async()=>{await api('finish',{});signoutUnconfirmed=false;await boot();});
  if(signoutUnconfirmed){status('Could not confirm sign-out. Retry before handing this device to another guest.');$('retry').hidden=false;}
 }
 for(const id of ['finish','inbox-finish','verify-finish'])$(id).addEventListener('click',finish);
 $('retry').addEventListener('click',boot);addEventListener('pageshow',boot);addEventListener('hashchange',boot);
 document.addEventListener('visibilitychange',()=>{if(document.hidden){++revision;clearPersonal();state=null;}else boot();});
})();
