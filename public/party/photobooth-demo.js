'use strict';
(()=>{
 const $=id=>document.getElementById(id);
 const camera=globalThis.createPhotoBooth();let context=null,generation=0,loading=false,capture=false,refreshAbort=null;
 const message=value=>{$('booth-message').textContent=value;};
 const clearCapture=()=>{camera.reset();capture=false;$('booth-capture').hidden=true;};
 function chooseParty(note='Enter your party code to get started.'){
  clearCapture();context=null;$('booth-party-name').textContent='Choose your party';$('booth-party-code').textContent='';$('booth-party-code').hidden=true;$('booth-code-input').value='';$('booth-welcome').hidden=true;$('booth-select').hidden=false;$('booth-switch-party').hidden=true;message(note);
 }
 function showWelcome(note='Choose how you want to join in.'){
  capture=false;$('booth-capture').hidden=true;$('booth-select').hidden=true;$('booth-welcome').hidden=false;$('booth-switch-party').hidden=false;
  $('booth-party-name').textContent=context.title;$('booth-party-code').textContent='Party code: '+context.code;$('booth-party-code').hidden=false;
  $('booth-take-photo').hidden=!context.features.takePhoto;
  const entry=$('booth-enter-contest');entry.hidden=!context.features.enterContest;
  if(context.contestAvailable){entry.href=context.contestUrl;entry.removeAttribute('aria-disabled');entry.removeAttribute('tabindex');}
  else{entry.removeAttribute('href');entry.setAttribute('aria-disabled','true');entry.setAttribute('tabindex','-1');}
  $('booth-contest-help').textContent=context.features.enterContest&&!context.contestAvailable?context.contestMessage:'';
  $('booth-disabled').hidden=context.features.takePhoto||context.features.enterContest;message(note);
 }
 async function refreshContext(code){
  if(loading)return null;loading=true;const current=generation;refreshAbort=new AbortController();const controller=refreshAbort;
  $('booth-code-submit').disabled=true;$('booth-take-photo').disabled=true;$('booth-retry').disabled=true;message('Checking party options…');
  try{
   const response=await fetch('/api/photobooth/context',{method:code===undefined?'GET':'POST',headers:code===undefined?{}:{'Content-Type':'application/json'},body:code===undefined?undefined:JSON.stringify({code}),credentials:'same-origin',cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(20000)])});
   const value=await response.json();if(current!==generation)return null;
   if(!response.ok)throw Error(value.error||'Could not load this party.');
   const changed=context&&context.eventId!==value.eventId;context=value;
   if(changed){clearCapture();showWelcome('The event changed. Choose an option for the current party.');return null;}
   if(capture&&!context.features.takePhoto){clearCapture();showWelcome('The host has turned off Take Photo.');return null;}
   if(!capture)showWelcome();return value;
  }catch(error){if(current===generation)chooseParty(error.name==='TimeoutError'?'The party server is taking a while to wake up. Please try again.':error.message);return null;}
  finally{if(current===generation){loading=false;$('booth-code-submit').disabled=false;$('booth-take-photo').disabled=false;$('booth-retry').disabled=false;}}
 }
 $('booth-code-form').addEventListener('submit',event=>{event.preventDefault();const code=$('booth-code-input').value.trim();if(!/^[0-9]{4,6}$/.test(code)){message('Enter a 4–6 digit party code.');return;}return refreshContext(code);});
 $('booth-take-photo').addEventListener('click',async()=>{const latest=await refreshContext();if(!latest?.features.takePhoto)return;clearCapture();capture=true;$('booth-welcome').hidden=true;$('booth-capture').hidden=false;message('Photos stay on this device. Start the camera when ready.');});
 const returnToWelcome=()=>{clearCapture();if(context){showWelcome();return refreshContext();}chooseParty();};
 $('booth-back').addEventListener('click',returnToWelcome);$('finish-photo').addEventListener('click',returnToWelcome);
 $('booth-retry').addEventListener('click',()=>refreshContext());
 $('booth-switch-party').addEventListener('click',async()=>{
  ++generation;refreshAbort?.abort();loading=false;chooseParty();$('booth-code-submit').disabled=true;
  try{const response=await fetch('/api/photobooth/context',{method:'DELETE',credentials:'same-origin',cache:'no-store'});if(!response.ok)message('Could not clear the saved party. Enter another code to switch.');}
  catch{message('Connection lost. Enter another code to switch when connected.');}
  finally{$('booth-code-submit').disabled=false;}
 });
 $('booth-enter-contest').addEventListener('click',async event=>{
  event.preventDefault();const latest=await refreshContext();if(latest?.contestAvailable){clearCapture();location.assign(latest.contestUrl);}
 });
 document.addEventListener('visibilitychange',()=>{if(document.hidden){++generation;refreshAbort?.abort();loading=false;clearCapture();}else if(context){showWelcome();refreshContext();}});
 addEventListener('pagehide',()=>{++generation;refreshAbort?.abort();loading=false;clearCapture();});
 addEventListener('pageshow',()=>{clearCapture();if(context)showWelcome();refreshContext();});
 setInterval(()=>{if(context&&!document.hidden&&!loading)return refreshContext();},30000);
 refreshContext();
})();
