// Original screens and layout, backed by the shared server. No local PIN or local vote totals.
'use strict';
(() => {
  const $=id=>document.getElementById(id);
  const node=(tag,cls='',value)=>{const n=document.createElement(tag);n.className=cls;if(value!==undefined)n.textContent=value;return n;};
  const defaults=['Best Overall','Spookiest','Kids','Most Creative','Funniest','Best Couple / Group'];
  const startRequestId=()=>`${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  let data=null,view='main',filter='All',pendingVote=null,editId=null,lightboxEntryId=null,photo=null,photoURL=null,newContest=false;
  let wizardStep=1,wizardMode='guest',wizardCategories=[...defaults],archive=null,loadedContestId=null,privacyTimer=null;
  let syncing=null,offset=0,loginInFlight=false,usingRecoveryCode=false;
  let nextPartySource=null,nextPartyDraft=null,nextPartyBusy=false;
  let hallItems=[],hallEditId=null,hallSaving=false;
  const action=fn=>async(...args)=>{try{return await fn(...args);}catch(e){status(e.message);}};
  function status(message=''){ $('sync-status').textContent=message;$('sync-status').classList.toggle('hidden',!message);const loginError=$('host-login-error');if(loginError)loginError.textContent=message; }
  async function api(url,method='GET',body){
    const headers={};if(method!=='GET')headers['X-CSRF-Token']=data?.csrf||'';
    if(body && !(body instanceof FormData)){headers['Content-Type']='application/json';body=JSON.stringify(body);}
    let r;try{r=await fetch(url,{method,headers,body,credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(20000)});}catch{throw new Error('Connection lost. Your last change was not confirmed. Please retry.');}
    const value=await r.json();if(!r.ok){if(r.status===401&&data){data.host=false;switchView('main');}throw new Error(value.error||'Could not save.');}return value;
  }
  function open(id){$(id)?.classList.remove('hidden');}function close(id){$(id)?.classList.add('hidden');}
  function switchView(name){
    if(name==='host'&&!data?.host){open('host-auth-modal');return;}
    if(name==='enter'&&!canUpload()){status('Photo submissions are closed.');return;}
    if(name==='vote'&&!isOpen()){status('Voting is closed.');return;}
    view=name;for(const v of ['main','enter','vote','past-winners','host','info'])$(`view-${v}`).classList.toggle('hidden',v!==name);
    $('archive-panel').classList.toggle('hidden',name!=='host'||!data?.host);
    document.querySelectorAll('.nav-btn').forEach(b=>{b.classList.toggle('text-orange-400',b.dataset.view===name);});
    if(name==='host'){fillHost();loadArchives().catch(e=>status(e.message));loadHallOfFame().catch(e=>status(e.message));}$('page-scroll').scrollTo?.({top:0,behavior:'smooth'});
  }
  const isOpen=()=>['live','voting_only'].includes(data?.phase);
  const canUpload=()=>!!data?.contest&&(data.host||(data.phase==='live'&&data.contest.settings.submissionMode!=='host_only'));
  const button=(label,fn,cls='archive-control')=>{const b=node('button',cls,label);b.type='button';b.addEventListener('click',action(fn));return b;};
  function localDate(iso,zone='America/Chicago'){
    const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(iso)).map(x=>[x.type,x.value]));return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
  }
  function fillSelect(id,items){const select=$(id),value=select.value;if(select.children.length===items.length&&[...select.children].every((o,i)=>o.value===items[i]))return;select.replaceChildren();for(const c of items){const o=node('option','',c);o.value=c;select.append(o);}if(items.includes(value))select.value=value;}
  async function refresh(){
    while(syncing)await syncing;
    const request=(async()=>{try{
      data=await api('/api/state');offset=data.serverTime-Date.now();status();render();
      if(data.host&&!newContest&&loadedContestId!==data.contest?.id){fillHost();loadedContestId=data.contest?.id;}
      if(data.host&&view==='host')await loadHallOfFame();
    }catch(e){status(e.message);}})();
    syncing=request;try{await request;}finally{if(syncing===request)syncing=null;}
  }
  function render(){
    let demoNotice=$('demo-notice');
    if(data.demoMode&&!demoNotice){demoNotice=node('div','p-3 text-center text-xs','FREE SAMPLE — Use test photos only. Photos, votes, messages and settings may reset when this service sleeps, restarts or updates.');demoNotice.id='demo-notice';demoNotice.setAttribute('role','note');document.body.prepend(demoNotice);}
    if(demoNotice)demoNotice.hidden=!data.demoMode;
    const c=data.contest,openNow=isOpen();
    $('host-auth-label').textContent=data.host?'Host Dashboard':'Host Unlock';
    renderLoginMode();
    $('app-title-display').textContent=c?.title||'Party Contest';
    $('party-tagline').textContent=c?.settings.tagline??'Eat. Drink. Claim the Belt.';
    $('current-party-summary').textContent=c?`${c.title} · ${{scheduled:'Scheduled',live:'Live',voting_only:'Voting open',closed:'Closed'}[data.phase]}`:'No party set up yet';
    const undo=data.host?data.nextPartyUndo:null;
    $('undo-next-party').classList.toggle('hidden',!undo);$('undo-next-party').disabled=!undo?.enabled;
    $('undo-next-party-help').textContent=undo?.reason||'';
    for(const id of ['party-backup-reminder','party-backup-link'])$(id).classList.toggle('hidden',!undo);
    if(!data.host)close('next-party-modal');
    $('hero-headline-text').textContent=c?.title||'Geech’s Halloween Costume Contest';
    $('hero-subtext').textContent=openNow?(data.phase==='live'?'Snap a photo or vote on your favorite party entrants!':'🗳️ Voting is open! Photo submissions are now closed.'):data.phase==='scheduled'?'Get your costume ready for the party!':'Celebrate our costume champions!';
    $('live-status-badge').textContent=openNow?'Contest Is Live':data.phase==='scheduled'?'Next Party Scheduled':'Past Champions';
    const visibleEntries=openNow?data.entries.filter(e=>!e.hidden):data.winners;
    $('home-photo-count-badge').textContent=`${visibleEntries.length} Photos`;
    for(const id of ['snap-action-btn','nav-btn-enter'])$(id).style.display=canUpload()?'flex':'none';
    for(const id of ['vote-action-btn','nav-btn-vote'])$(id).style.display=openNow?'flex':'none';
    $('announcement-ticker').classList.toggle('hidden',!openNow||!c?.settings.announcement);$('announcement-text').textContent=openNow?c?.settings.announcement||'':'';
    $('message-board-feed').closest('.panel-card').classList.remove('hidden');
    for(const id of ['msg-author-input','msg-text-input'])$(id).disabled=!openNow;
    $('msg-text-input').closest('form').querySelector('button').disabled=!openNow;
    const cats=c?.settings.categories||defaults;
    fillSelect('entry-category',cats);
    const tiles=$('home-category-tiles-container');tiles.replaceChildren();
    for(const cat of ['All',...cats])tiles.append(button(cat,()=>{filter=cat;renderGallery();renderVotes();},`px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap ${cat===filter?'bg-orange-500 text-white':'bg-slate-800 text-gray-300'} border border-gray-700`));
    renderGallery();renderVotes();renderWinners();renderMessages();renderHostCategories();renderLightboxVote();tick();
    $('archive-panel').classList.toggle('hidden',view!=='host'||!data.host);
    clearTimeout(privacyTimer);
    if(openNow&&!data.host){privacyTimer=setTimeout(()=>{data.phase='closed';data.entries=[];data.messages=[];closeLightbox();close('entry-info-modal');close('vote-confirm-modal');if(view==='vote'||view==='enter')switchView('main');render();refresh();},Math.max(0,Math.min(Date.parse(c.settings.end)-data.serverTime,2147483647)));}
  }
  function renderGallery(){
    const grid=$('home-photo-grid');grid.replaceChildren();
    const list=(isOpen()?data.entries.filter(e=>!e.hidden):data.winners).filter(e=>filter==='All'||e.category===filter);
    for(const e of list){const wrap=node('div','relative aspect-square rounded-2xl overflow-hidden bg-black/60 border border-gray-800 cursor-pointer shadow-lg');const img=node('img','w-full h-full object-cover');img.src=e.photoUrl;img.alt=e.name;img.loading='lazy';wrap.append(img);wrap.addEventListener('click',()=>window.openGalleryPhoto(e.id));grid.append(wrap);}
    if(!list.length&&canUpload()&&isOpen())for(const cat of (filter==='All'?data.contest.settings.categories:[filter])){const b=button('',()=>{fillSelect('entry-category',data.contest.settings.categories);$('entry-category').value=cat;switchView('enter');},'aspect-square rounded-2xl border-2 border-dashed border-orange-500/30 bg-orange-950/10 p-3 flex flex-col items-center justify-center text-center');b.append(node('span','text-xl text-orange-400','?'),node('span','text-xs font-bold text-gray-300',cat),node('span','text-[9px] text-orange-400','Tap to be 1st! 📸'));grid.append(b);}
    if(!grid.children.length)grid.append(node('p','text-xs text-gray-400 p-4',isOpen()?'No entries yet. Be the first!':'Published winners will appear here. Other photos remain in the host’s private archive.'));
  }
  function renderVotes(){
    const list=$('voting-feed-list');list.replaceChildren();if(!isOpen())return;
    for(const e of data.entries.filter(e=>!e.hidden&&(filter==='All'||e.category===filter))){
      const box=node('div','panel-card p-3 rounded-2xl space-y-2 shadow-xl vote-entry-card');const img=node('img','aspect-square w-full rounded-xl object-cover');img.src=e.photoUrl;img.alt=e.name;img.loading='lazy';img.addEventListener('click',()=>window.openGalleryPhoto(e.id));
      box.append(img,node('span','text-xs text-orange-300',e.category),node('h3','text-xs font-bold text-white',e.name),node('p','text-[10px] text-gray-400',e.caption));
      const used=data.myVotes.find(v=>v.category===e.category),b=button(used?(used.entryId===e.id?'✓ Voted!':'Category Voted'):'🍬 Cast Vote',()=>window.openVoteConfirmModal(e.id),'w-full px-2 py-2 rounded-xl btn-accent text-xs font-bold');b.disabled=!!used;box.append(b);list.append(box);
    }
    if(!list.children.length)list.append(node('p','text-xs text-gray-400 p-4','No entrants available to vote on yet.'));
  }
  function renderWinners(){
    const content=$('past-winners-content');content.replaceChildren();
    for(const w of data.winners){const box=node('div','flex items-center gap-3.5 p-3.5 rounded-2xl bg-black/40 border border-amber-500/30 shadow-lg'),img=node('img','w-14 h-14 rounded-2xl object-cover');img.src=w.photoUrl;img.alt=w.name;img.addEventListener('click',()=>window.openLightbox(w.photoUrl,`${w.name} — ${w.category}`));const text=node('div','flex-1');text.append(node('h4','text-xs font-bold text-white',w.name),node('p','text-[10px] text-orange-400',w.category),node('p','text-[10px] text-gray-400',w.contestTitle));box.append(img,text);content.append(box);}
    if(!content.children.length)content.append(node('p','text-xs text-gray-400 text-center p-4','👑 No Champions Crowned Yet! Category winners will appear after the host publishes them.'));
  }
  function renderMessages(){const feed=$('message-board-feed');feed.replaceChildren();const messages=isOpen()?data.messages.filter(m=>!m.hidden):[];$('message-count-badge').textContent=`${messages.length} Messages`;for(const m of messages){const row=node('div','p-2.5 rounded-xl bg-black/40 border border-gray-800 space-y-1');row.append(node('span','text-xs font-bold text-purple-300',m.author),node('p','text-xs text-gray-200',m.message));feed.append(row);}if(!messages.length)feed.append(node('p','text-xs text-gray-300',isOpen()?'Be the first to leave a message or cheer!':data.phase==='scheduled'?'Chat opens when the party starts.':'Chat is closed until the next party.'));}
  function renderLightboxVote(){
    const vote=$('lightbox-vote');
    const entry=lightboxEntryId&&data?.entries.find(e=>e.id===lightboxEntryId&&!e.hidden);
    const available=!!entry&&isOpen();vote.classList.toggle('hidden',!available);
    if(!available){vote.disabled=true;return;}
    const used=data.myVotes.find(v=>v.category===entry.category);
    vote.disabled=!!used;vote.textContent=used?(used.entryId===entry.id?'✓ You voted for this photo':'You already voted in this category'):'🍬 Vote for this photo';
  }
  function tick(){
    if(!data)return;const s=data.contest?.settings,now=Date.now()+offset;
    const container=$('countdown-banner');container.replaceChildren();
    for(const [key,label] of [['start','⏳ Party Starts In'],['entriesClose','📸 Entries Close In'],['end','🗳️ Voting Closes In']]){
      const target=Date.parse(s?.[key]);if(!Number.isFinite(target)||target<=now)continue;
      let seconds=Math.ceil((target-now)/1000);const days=Math.floor(seconds/86400);seconds%=86400;const h=Math.floor(seconds/3600),m=Math.floor(seconds%3600/60),ss=seconds%60;
      const card=node('div','countdown-card');card.setAttribute('data-countdown',key);
      card.append(node('h3','text-xs text-orange-300',label),node('p','font-mono text-xl text-amber-300',`${days}d : ${String(h).padStart(2,'0')}h : ${String(m).padStart(2,'0')}m : ${String(ss).padStart(2,'0')}s`),node('p','text-xs text-gray-300',`${new Date(target).toLocaleString(undefined,{timeZone:'America/Chicago'})} · Central Time`));container.append(card);
    }
    container.classList.toggle('hidden',!container.children.length);
  }
  function fillHost(){
    const c=newContest?null:data.contest,s=c?.settings,zone='America/Chicago';
    $('host-contest-title').value=c?.title||'';$('host-timezone').value=zone;
    $('host-tagline').value=s?.tagline??'Eat. Drink. Claim the Belt.';
    for(const [key,id] of [['start','host-party-datetime'],['entriesClose','host-entries-close-datetime'],['end','host-event-close-datetime']])$(id).value=s?.[key]?localDate(s[key],zone):'';
    $('host-event-status-override').value=s?.override||'auto';$('host-submission-mode').value=s?.submissionMode||'guest';$('host-announcement-input').value=s?.announcement||'';
    renderHostCategories();
  }
  function renderHostCategories(){if(!data?.host)return;const list=$('host-categories-list');list.replaceChildren();for(const cat of (newContest?wizardCategories:data.contest?.settings.categories||defaults)){const pill=node('span','inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-purple-950/60 border border-purple-500/40 text-xs text-purple-200',cat);pill.append(button('×',()=>window.removeHostCategory(cat),'text-red-400'));list.append(pill);}}
  async function saveSettings(overrides={}){
    if(!data.host)throw new Error('Host login required.');
    const c=newContest?null:data.contest,old=c?.settings||{};
    const settings={...old,timezone:'America/Chicago',start:$('host-party-datetime').value,entriesClose:$('host-entries-close-datetime').value,end:$('host-event-close-datetime').value,categories:old.categories||wizardCategories,submissionMode:$('host-submission-mode').value,announcement:$('host-announcement-input').value,override:$('host-event-status-override').value,theme:old.theme||'halloween',...overrides};
    settings.tagline=$('host-tagline').value.trim();
    const title=$('host-contest-title').value.trim();if(!title)throw new Error('Enter a contest name in the host panel first.');
    if(!confirm(c?'Save this schedule and settings? Photos are public only within the scheduled party hours.':'Create the new contest? Previous years and photos are kept privately.'))return false;
    await api(c?`/api/host/contests/${c.id}`:'/api/host/contests',c?'PUT':'POST',{title,settings,expectedCurrentId:data.contest?.id??null,requestId:startRequestId()});newContest=false;await refresh();fillHost();await loadArchives();return true;
  }
  async function loadArchives(){if(!data?.host)return;const list=await api('/api/host/contests'),select=$('archive-select'),selected=select.value;select.replaceChildren();for(const c of list){const date=c.settings.start?new Date(c.settings.start).toLocaleDateString(undefined,{timeZone:c.settings.timezone}):'No date';const o=node('option','',`${c.title} · ${date}${c.archived?' · archived':' · current'}`);o.value=c.id;select.append(o);}if(list.some(c=>c.id===selected))select.value=selected;if(list.length)await loadArchive();}
  async function loadArchive(){
    const id=$('archive-select').value;if(!id)return;archive=await api(`/api/host/contests/${id}/archive`);
    const results=$('archive-results');results.replaceChildren();
    const closed=archive.contest.archived||archive.contest.settings.override==='closed'||Date.parse(archive.contest.settings.end)<=Date.now()+offset,manual=!!archive.contest.settings.historical;
    for(const cat of archive.contest.settings.categories){
      const rows=archive.entries.filter(e=>e.category===cat&&!e.hidden),max=Math.max(0,...rows.map(e=>e.votes));
      const box=node('div','archive-category');box.append(node('h3','text-xs font-bold text-orange-300',cat),node('p','text-xs text-gray-400',rows.map(e=>`${e.name}: ${e.votes}`).join(' · ')||'No entries'));
      const select=node('select','archive-control');select.append(node('option','','Choose a leading entry'));
      for(const e of rows.filter(e=>manual||(max>0&&e.votes===max))){const o=node('option','',manual?e.name:`${e.name} (${e.votes})`);o.value=e.id;select.append(o);}
      const winner=archive.winners.find(w=>w.category===cat);if(winner)select.value=winner.entryId;
      const publish=button(winner?'Update published winner':'Publish category winner',async()=>{if(!rows.some(e=>e.id===select.value))throw new Error('Select a leading entry.');if(!confirm('Publish this winning photo year-round? Anyone with the link can view or save it.'))return;await api('/api/host/winners','PUT',{contestId:id,category:cat,entryId:select.value});await refresh();await loadArchive();});publish.disabled=!closed||(!manual&&max===0);box.append(select,publish);
      if(winner)box.append(button('Unpublish winner',async()=>{await api('/api/host/winners','PUT',{contestId:id,category:cat,entryId:null});await refresh();await loadArchive();}));results.append(box);
    }
    const gallery=$('archive-entries');gallery.replaceChildren();for(const e of archive.entries){const box=node('div','space-y-2'),img=node('img');img.src=e.photoUrl;img.alt=e.name;img.loading='lazy';const a=node('a','text-xs text-orange-300','Download photo ↗');a.href=e.photoUrl;a.download=`${e.id}.jpg`;box.append(img,node('p','text-xs text-gray-300',`${e.name} · ${e.votes} votes`),a,button('Edit details',()=>window.openEntryInfoModal(e.id)),button(e.hidden?'Restore entry':'Hide entry',async()=>{await api('/api/host/moderate','POST',{type:'entries',id:e.id,hidden:!e.hidden});await refresh();await loadArchive();}));gallery.append(box);}
  }
  window.switchView=switchView;
  function renderLoginMode(){
    $('host-auth-modal').querySelector('h3').textContent=usingRecoveryCode?'Host Recovery Code':(data?.localPreview||data?.demoMode)?'Host PIN':'Host Password';
    $('host-pin-input').placeholder=usingRecoveryCode?'Enter saved recovery code...':(data?.localPreview||data?.demoMode)?'Enter host PIN...':'Enter host password...';
    $('host-auth-modal').querySelector('p').textContent=usingRecoveryCode?'Use your saved recovery code if the regular PIN no longer works.':'Enter your host PIN or password. This is verified by the server.';
    $('host-recovery-toggle').textContent=usingRecoveryCode?'Use regular PIN / password':'Use recovery code instead';
  }
  window.openHostAuthModal=()=>data?.host?switchView('host'):open('host-auth-modal');window.closeHostAuthModal=()=>close('host-auth-modal');
  window.authenticateHost=action(async()=>{
    if(loginInFlight)return;if(!data?.csrf)throw new Error('Still connecting to the server. Wait a moment and try again.');
    loginInFlight=true;const unlock=$('host-unlock-submit');unlock.disabled=true;
    try{const value=$('host-pin-input').value.trim();await api(usingRecoveryCode?'/api/recovery-login':'/api/login','POST',usingRecoveryCode?{code:value}:{password:value});await refresh();if(!data.host)throw new Error('Sign-in could not be confirmed. Please try again.');$('host-pin-input').value='';close('host-auth-modal');switchView('host');}
    finally{loginInFlight=false;unlock.disabled=false;}
  });
  window.lockHostSession=action(async()=>{await api('/api/logout','POST',{});archive=null;$('archive-entries').replaceChildren();$('archive-results').replaceChildren();await refresh();switchView('main');});
  window.openPinChangeModal=()=>{
    if(!data?.host)return window.openHostAuthModal();
    $('new-pin-input').value='';$('confirm-pin-input').value='';$('password-change-error').textContent='';
    $('password-change-help').textContent=data.localPreview?'Use a 4–8 digit PIN or a password of at least 12 characters. Your recovery code will stay the same.':'Use a password of at least 12 characters. Your recovery code will stay the same.';open('pin-change-modal');
  };
  $('password-change-cancel').addEventListener('click',()=>close('pin-change-modal'));
  $('password-change-save').addEventListener('click',async()=>{
    const button=$('password-change-save');button.disabled=true;
    try{const password=$('new-pin-input').value;if(password!==$('confirm-pin-input').value)throw new Error('The new passwords do not match.');await api('/api/host/password','POST',{password});$('new-pin-input').value='';$('confirm-pin-input').value='';close('pin-change-modal');await refresh();status('Host password changed. Your recovery code is unchanged.');}
    catch(e){$('password-change-error').textContent=e.message;}finally{button.disabled=false;}
  });
  window.handleEnterButtonClick=()=>switchView('enter');
  window.handleFileSelect=e=>{photo=e.target.files[0]||null;if(photoURL)URL.revokeObjectURL(photoURL);if(photo){photoURL=URL.createObjectURL(photo);$('image-preview').src=photoURL;close('upload-placeholder');open('image-preview-container');}};
  window.clearSelectedPhoto=e=>{e?.stopPropagation();photo=null;if(photoURL)URL.revokeObjectURL(photoURL);photoURL=null;$('camera-file-input').value='';open('upload-placeholder');close('image-preview-container');};
  window.handleFormSubmit=action(async e=>{e.preventDefault();if(!photo||photo.size>8*1024*1024)throw new Error('Choose one JPEG, PNG, or WebP photo, up to 8 MB.');const form=new FormData();form.append('name',$('entry-name').value);form.append('category',$('entry-category').value);form.append('caption',$('entry-caption').value);form.append('photo',photo);await api('/api/entries','POST',form);window.clearSelectedPhoto();$('entry-name').value='';$('entry-caption').value='';await refresh();switchView('main');});
  window.handlePostMessage=action(async e=>{e.preventDefault();await api('/api/messages','POST',{author:$('msg-author-input').value||'Anonymous Guest',message:$('msg-text-input').value});$('msg-text-input').value='';await refresh();});
  window.openEntryInfoModal=id=>{const e=[...(data.host?archive?.entries||[]:[]),...data.entries,...data.winners].find(e=>e.id===id);if(!e)return;if(!data.host&&(!e.canEdit||data.phase!=='live')){window.openLightbox(e.photoUrl,`${e.name} — ${e.category}`);return;}editId=id;const c=e.contestId===archive?.contest.id?archive.contest:data.contest;fillSelect('modal-entry-category',c?.id===e.contestId?c.settings.categories:[e.category]);$('modal-entry-name').value=e.name;$('modal-entry-caption').value=e.caption;$('modal-entry-category').value=e.category;const locked=!data.host||!!e.votes||data.winners.some(w=>w.id===id);$('modal-entry-category').disabled=locked;$('entry-category-help').textContent=locked?'Category stays fixed after votes are cast or a winner is published.':'The host can correct the category before this entry receives votes.';open('entry-info-modal');};
  window.closeEntryInfoModal=()=>{close('entry-info-modal');editId=null;};
  window.saveEntryDetails=action(async e=>{e.preventDefault();if(!editId)return;await api(`/api/entries/${editId}`,'PUT',{name:$('modal-entry-name').value,caption:$('modal-entry-caption').value,...(!$('modal-entry-category').disabled?{category:$('modal-entry-category').value}:{})});window.closeEntryInfoModal();await refresh();if(view==='host'&&archive)await loadArchive();});
  window.openVoteConfirmModal=id=>{const e=data.entries.find(e=>e.id===id);if(!e||!isOpen())return;if(data.myVotes.some(v=>v.category===e.category)){status('You have already voted in this category.');return;}pendingVote=id;$('vote-modal-entry-info').textContent=`Vote for ${e.name} (${e.category})? One vote per browser per category. No email needed.`;open('vote-confirm-modal');};
  window.closeVoteModal=()=>{pendingVote=null;close('vote-confirm-modal');};
  window.confirmCastVote=action(async()=>{if(!pendingVote)return;await api('/api/votes','POST',{entryId:pendingVote});window.closeVoteModal();await refresh();status('🍬 Your vote was saved!');});
  window.openLightbox=(url,caption)=>{lightboxEntryId=null;$('lightbox-img').src=url;$('lightbox-img').alt=caption;$('lightbox-caption').textContent=caption;renderLightboxVote();open('lightbox-modal');};
  window.openGalleryPhoto=id=>{const e=[...data.entries,...data.winners].find(e=>e.id===id);if(!e)return;window.openLightbox(e.photoUrl,`${e.name} — ${e.category}${e.caption?' · '+e.caption:''}`);lightboxEntryId=id;renderLightboxVote();};
  function closeLightbox(){close('lightbox-modal');$('lightbox-img').removeAttribute('src');lightboxEntryId=null;renderLightboxVote();}window.closeLightbox=closeLightbox;
  window.closeWinnerModal=()=>close('winner-reveal-modal');
  window.generatePrintableQrModal=()=>{$('qr-modal-img').src='/api/qr';$('qr-modal-url-text').textContent=`${location.origin}/party/`;open('qr-modal');};window.closeQrModal=()=>close('qr-modal');window.printQrCard=()=>window.print();
  window.saveHostScheduleSettings=action(()=>saveSettings());window.updateHostSettings=action(()=>saveSettings());
  window.addHostCategory=action(async()=>{const category=$('host-new-category-input').value.trim();if(!category)return;const cats=[...(data.contest?.settings.categories||defaults)];if(!cats.includes(category))cats.push(category);if(await saveSettings({categories:cats}))$('host-new-category-input').value='';});
  window.removeHostCategory=action(async cat=>{await saveSettings({categories:(data.contest?.settings.categories||defaults).filter(c=>c!==cat)});});
  window.clearAllEntries=()=>{
    if(!data?.host)return;
    nextPartySource=data.contest?JSON.parse(JSON.stringify(data.contest)):null;nextPartyDraft=null;
    $('next-party-name-choice').value=nextPartySource?'same':'new';$('next-party-name-choice').disabled=!nextPartySource;
    $('next-party-name').value=nextPartySource?.title||'';$('next-party-name').disabled=!!nextPartySource;
    for(const id of ['next-party-start','next-party-entries-close','next-party-end'])$(id).value='';
    $('next-party-copy-details').textContent='Categories, tagline and upload mode will be copied. Enter new dates in Central Time.';
    open('next-party-fields');close('next-party-review');close('next-party-back');close('next-party-backup');open('next-party-submit');
    $('next-party-submit').textContent='Review & Continue';$('next-party-cancel').textContent='Cancel';$('next-party-status').textContent='';
    $('next-party-submit').disabled=isOpen();
    if(isOpen())$('next-party-status').textContent='The current party is live. Close it in Host settings before starting another.';
    open('next-party-modal');
  };
  $('next-party-name-choice').addEventListener('change',()=>{
    const same=$('next-party-name-choice').value==='same';$('next-party-name').disabled=same;
    $('next-party-name').value=same?nextPartySource?.title||'':'';
  });
  $('next-party-cancel').addEventListener('click',()=>{if(!nextPartyBusy){close('next-party-modal');nextPartyDraft=null;}});
  $('next-party-back').addEventListener('click',()=>{if(nextPartyBusy)return;nextPartyDraft=null;open('next-party-fields');close('next-party-review');close('next-party-back');$('next-party-submit').textContent='Review & Continue';$('next-party-status').textContent='';});
  $('next-party-submit').addEventListener('click',async()=>{
    if(nextPartyBusy)return;
    const submit=$('next-party-submit');
    try{
      if(!nextPartyDraft){
        if(isOpen())throw new Error('Close the current party before starting another.');
        const title=$('next-party-name-choice').value==='same'?nextPartySource?.title:$('next-party-name').value.trim();
        if(!title||title.length>100)throw new Error('Enter a party name, up to 100 characters.');
        const start=$('next-party-start').value,entriesClose=$('next-party-entries-close').value,end=$('next-party-end').value;
        if(!start||!entriesClose||!end||!(start<entriesClose&&entriesClose<=end))throw new Error('Enter new dates: party start must be before entry closing, and entry closing must be at or before voting closes.');
        const old=nextPartySource?.settings;
        nextPartyDraft={title,requestId:startRequestId(),expectedCurrentId:nextPartySource?.id??null,settings:{categories:[...(old?.categories||defaults)],tagline:old?.tagline??'Eat. Drink. Claim the Belt.',timezone:'America/Chicago',submissionMode:old?.submissionMode||'guest',theme:old?.theme||'halloween',announcement:'',override:'auto',start,entriesClose,end}};
        $('next-party-review').textContent=nextPartySource?`Archive ${nextPartySource.title} and create ${title}? Photos, votes, and messages will be saved in your host-only archive. Published winners will stay public. New party: ${start.replace('T',' ')} to ${end.replace('T',' ')}; entries close ${entriesClose.replace('T',' ')} (${nextPartyDraft.settings.timezone}).`:`Create ${title}? New party: ${start.replace('T',' ')} to ${end.replace('T',' ')} (${nextPartyDraft.settings.timezone}).`;
        close('next-party-fields');open('next-party-review');open('next-party-back');submit.textContent=nextPartySource?'Archive & Create Party':'Create Party';$('next-party-status').textContent='';return;
      }
      nextPartyBusy=true;submit.disabled=true;$('next-party-back').disabled=true;$('next-party-cancel').disabled=true;$('next-party-status').textContent='Saving your party and archive…';
      await api('/api/host/contests','POST',nextPartyDraft);
      newContest=false;nextPartyDraft=null;close('next-party-submit');close('next-party-back');close('next-party-review');
      $('next-party-status').textContent=nextPartySource?'New party created. Previous party data is preserved in your host-only Archives. Download a backup for an extra copy.':'Your first party is ready. You can manage it in Host settings.';
      open('next-party-backup');$('next-party-cancel').textContent='Done';await refresh();fillHost();await loadArchives();
    }catch(e){$('next-party-status').textContent=e.message;}
    finally{nextPartyBusy=false;submit.disabled=false;$('next-party-back').disabled=false;$('next-party-cancel').disabled=false;}
  });
  $('host-open-archives').addEventListener('click',()=>window.privateWinnerPreview());
  $('undo-next-party').addEventListener('click',action(async()=>{
    const info=data?.nextPartyUndo;if(!data?.host||!info?.enabled||$('undo-next-party').disabled)return;
    if(!confirm(`Undo starting this party and restore ${info.previousTitle}? It will stay closed, and the empty newer party will remain in your private archive.`))return;
    $('undo-next-party').disabled=true;
    try{await api(`/api/host/contests/${info.currentId}/undo-start`,'POST',{previousId:info.previousId});await refresh();fillHost();await loadArchives();status('Previous party restored as closed. The empty newer party is preserved in Archives.');}
    finally{$('undo-next-party').disabled=!data?.nextPartyUndo?.enabled;}
  }));
  window.privateWinnerPreview=action(async()=>{await loadArchives();$('archive-panel').scrollIntoView({behavior:'smooth'});});window.publishWinnerModal=window.privateWinnerPreview;
  window.openWizardModal=()=>{if(!data.host)return;wizardCategories=[...(data.contest?.settings.categories||defaults)];wizardMode=data.contest?.settings.submissionMode||'guest';for(const [key,id] of [['start','wizard-party-datetime'],['entriesClose','wizard-entries-close-datetime'],['end','wizard-event-close-datetime']])$(id).value=data.contest?localDate(data.contest.settings[key],'America/Chicago'):'';window.goToWizardStep(1);open('host-wizard-modal');};
  function renderWizardSubmissionMode(){
    const names={guest:'Guest Self-Upload',host_only:'Host Intake Only',hybrid:'Hybrid (Both)'};
    for(const mode of Object.keys(names)){
      const selected=mode===wizardMode,control=$(`sub-mode-${mode}-btn`);
      control.setAttribute('aria-pressed',String(selected));
      for(const cls of ['bg-purple-600/30','border-purple-500'])control.classList.toggle(cls,selected);
      for(const cls of ['bg-black/60','border-gray-800'])control.classList.toggle(cls,!selected);
    }
    $('wizard-mode-status').textContent=`Selected: ${names[wizardMode]}`;
  }
  window.goToWizardStep=step=>{wizardStep=step;for(let i=1;i<=3;i++)$(`wizard-step-${i}-content`).classList.toggle('hidden',step!==i);renderWizardCategories();renderWizardSubmissionMode();};
  window.setWizardSubmissionMode=mode=>{if(!['guest','host_only','hybrid'].includes(mode))return;wizardMode=mode;renderWizardSubmissionMode();};
  function renderWizardCategories(){const list=$('wizard-categories-list');list.replaceChildren();for(const cat of wizardCategories){const row=node('span','inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-purple-950/60 border border-purple-500/40 text-xs text-purple-200',cat);row.append(button('×',()=>window.removeWizardCategory(cat),'text-red-400'));list.append(row);}}
  window.addWizardCategory=()=>{const c=$('wizard-category-input').value.trim();if(c&&!wizardCategories.includes(c))wizardCategories.push(c);$('wizard-category-input').value='';renderWizardCategories();};window.removeWizardCategory=cat=>{if(wizardCategories.length>1)wizardCategories=wizardCategories.filter(c=>c!==cat);renderWizardCategories();};
  window.finishHostWizard=action(async()=>{for(const [key,id] of [['start','wizard-party-datetime'],['entriesClose','wizard-entries-close-datetime'],['end','wizard-event-close-datetime']])$( {start:'host-party-datetime',entriesClose:'host-entries-close-datetime',end:'host-event-close-datetime'}[key]).value=$(id).value;if(!$('host-contest-title').value){const title=prompt('What is this contest called? For example, Halloween 2026.');if(!title)return;$('host-contest-title').value=title;}if(await saveSettings({categories:wizardCategories,submissionMode:wizardMode,override:'auto'})){close('host-wizard-modal');switchView('host');}});
  window.handleHostPwFileSelect=e=>{$('host-pw-file-text').textContent=e.target.files[0]?.name||'Upload Photo';};
  function resetHallEditor(){hallEditId=null;for(const id of ['host-pw-name','host-pw-category','host-pw-year','host-pw-file'])$(id).value='';$('hall-form-heading').textContent='Add Historical Winner';$('hall-save-winner').textContent='Save Historical Winner Privately';close('hall-cancel-edit');}
  async function loadHallOfFame(){
    if(!data?.host)return;
    hallItems=await api('/api/host/hall-of-fame');const list=$('host-past-winners-list');list.replaceChildren();
    for(const record of hallItems){
      const box=node('div','p-3 rounded-xl bg-black/40 space-y-2'),image=node('img','w-14 h-14 rounded-xl object-cover mx-auto');image.src=record.photoUrl;image.alt=record.name;
      box.append(image,node('h4','text-xs font-bold text-amber-300',record.name),node('p','text-xs text-gray-300',`${record.contestTitle} · ${record.category}`),node('p','text-xs text-orange-300',record.published?'Published — visible year-round':'Private historical record — not published'));
      box.append(button('Edit winner',()=>{
        if(!record.historical){window.openEntryInfoModal(record.id);return;}
        hallEditId=record.id;$('host-pw-name').value=record.name;$('host-pw-category').value=record.category;$('host-pw-year').value=record.contestTitle;$('host-pw-file').value='';$('hall-form-heading').textContent='Edit Historical Winner';$('hall-save-winner').textContent='Save Winner Changes';$('hall-form-status').textContent='Leave the photo blank to keep the current one.';open('hall-cancel-edit');$('hall-winner-form').scrollIntoView({behavior:'smooth'});
      }));
      const publish=button(record.published?'Remove from Hall of Fame':'Publish to Hall of Fame',async()=>{
        if(!confirm(record.published?'Remove this winner from public display? The photo will remain in your private archive.':'Publish this winner year-round? Anyone with the link can view or save the photo.'))return;
        await api('/api/host/winners','PUT',{contestId:record.contestId,category:record.category,entryId:record.published?null:record.id});await refresh();await loadHallOfFame();await loadArchives();
      });publish.disabled=!!record.hidden;box.append(publish);list.append(box);
    }
    if(!hallItems.length)list.append(node('p','text-xs text-gray-400','No Hall of Fame records yet. Add a historical winner above, or publish a voted winner from Archives.'));
  }
  window.addHostPastWinner=async()=>{
    if(hallSaving||!data?.host)return;
    const save=$('hall-save-winner');
    try{
      const name=$('host-pw-name').value.trim(),category=$('host-pw-category').value.trim(),title=$('host-pw-year').value.trim(),file=$('host-pw-file').files?.[0];
      if(!name||!category||!title)throw new Error('Enter a winner name, category, and party / year.');
      if(!hallEditId&&!file)throw new Error('Choose a photo for the historical winner.');
      if(file&&file.size>8*1024*1024)throw new Error('Choose a photo up to 8 MB.');
      if(hallEditId&&hallItems.find(r=>r.id===hallEditId)?.published&&!confirm('Save changes to this published winner? The updated details and photo will be visible year-round.'))return;
      hallSaving=true;save.disabled=true;$('hall-form-status').textContent='Saving winner…';
      const form=new FormData();form.append('name',name);form.append('category',category);form.append('title',title);if(file)form.append('photo',file);
      const editing=!!hallEditId;await api(hallEditId?`/api/host/hall-of-fame/${hallEditId}`:'/api/host/hall-of-fame',hallEditId?'PUT':'POST',form);
      resetHallEditor();$('hall-form-status').textContent=editing?'Winner changes saved.':'Winner saved privately. Click Publish to Hall of Fame when ready.';
      await refresh();await loadHallOfFame();await loadArchives();
    }catch(e){$('hall-form-status').textContent=e.message;}
    finally{hallSaving=false;save.disabled=false;}
  };
  $('hall-save-winner').addEventListener('click',()=>window.addHostPastWinner());
  $('hall-cancel-edit').addEventListener('click',()=>{if(!hallSaving){resetHallEditor();$('hall-form-status').textContent='';}});
  // Only fixed function names and literal static arguments from the original markup can run.
  const allowed=new Set(['switchView','openHostAuthModal','closeHostAuthModal','authenticateHost','lockHostSession','openPinChangeModal','handleEnterButtonClick','handleFileSelect','clearSelectedPhoto','handleFormSubmit','handlePostMessage','closeEntryInfoModal','saveEntryDetails','closeVoteModal','confirmCastVote','closeWinnerModal','closeLightbox','generatePrintableQrModal','closeQrModal','printQrCard','saveHostScheduleSettings','updateHostSettings','addHostCategory','clearAllEntries','privateWinnerPreview','publishWinnerModal','openWizardModal','goToWizardStep','setWizardSubmissionMode','addWizardCategory','finishHostWizard','handleHostPwFileSelect','addHostPastWinner']);
  for(const eventName of ['click','change','submit'])document.addEventListener(eventName,event=>{
    const target=event.target.closest(`[data-on${eventName}]`);if(!target)return;const code=target.getAttribute(`data-on${eventName}`);
    if(code==='event.stopPropagation()'){event.stopPropagation();return;}
    const match=code.match(/^(?:window\.)?(\w+)\((.*)\)$/);if(!match||!allowed.has(match[1]))return;
    if(eventName==='submit')event.preventDefault();const arg=match[2].trim();let args=[];
    if(arg==='event')args=[event];else if(/^'[^']*'$/.test(arg))args=[arg.slice(1,-1)];else if(/^\d+$/.test(arg))args=[Number(arg)];else if(arg) return;
    window[match[1]](...args);
  });
  $('host-unlock-submit').addEventListener('click',e=>{e.preventDefault();window.authenticateHost();});
  $('host-recovery-toggle').addEventListener('click',()=>{usingRecoveryCode=!usingRecoveryCode;$('host-pin-input').value='';status();renderLoginMode();});
  for(const mode of ['guest','host_only','hybrid'])$(`sub-mode-${mode}-btn`).addEventListener('click',()=>window.setWizardSubmissionMode(mode));
  $('lightbox-vote').addEventListener('click',()=>{const id=lightboxEntryId;if(!id||$('lightbox-vote').disabled)return;closeLightbox();window.openVoteConfirmModal(id);});
  $('host-pin-input').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();window.authenticateHost();}});
  $('archive-select').addEventListener('change',action(loadArchive));
  const email=$('vote-email-input');if(email)email.closest('div').classList.add('hidden');
  $('host-auth-modal').querySelector('h3').textContent='Host Password';
  $('host-auth-modal').querySelector('p').textContent='Enter the host password. This is verified by the server.';
  const loginError=node('p','text-xs text-red-300');loginError.id='host-login-error';loginError.setAttribute('role','alert');$('host-pin-input').after(loginError);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
  refresh();setInterval(refresh,5000);setInterval(tick,1000);
})();
