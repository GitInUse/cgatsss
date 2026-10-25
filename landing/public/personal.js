'use strict';
const status=document.getElementById('status');
document.getElementById('logout')?.addEventListener('click',async event=>{
 event.target.disabled=true;
 try{
  const response=await fetch('/api/personal/logout',{method:'POST',headers:{'X-Personal-Action':'1'},cache:'no-store'});
  if(!response.ok)throw new Error('Could not log out. Please try again.');
  location.replace('/login');
 }catch(error){status.textContent=error.message;event.target.disabled=false;}
});
addEventListener('pageshow',async()=>{try{const response=await fetch('/api/personal/session',{cache:'no-store',redirect:'error'});if(!response.ok||!(await response.json()).authenticated)location.replace('/login');}catch{location.replace('/login');}});
