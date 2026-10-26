import {partyDirectory,PARTY_CODE_PATTERN,selectionCookie,selectedParty} from './party-directory.js';
const reply=(data,status=200,extra={})=>Response.json(data,{status,headers:{'Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff',...extra}});
async function limitedText(body,limit){
 const reader=body?.getReader();if(!reader)return '';const decoder=new TextDecoder();let bytes=0,text='';
 for(;;){const {value,done}=await reader.read();if(done)break;bytes+=value.length;if(bytes>limit){await reader.cancel();throw Error('Too large');}text+=decoder.decode(value,{stream:true});}
 return text+decoder.decode();
}
export async function boothContextRoute(request,env,fetcher=fetch){
 if(new URL(request.url).pathname!=='/api/photobooth/context')return null;
 const origin=new URL(request.url).origin;
 if(!['GET','POST','DELETE'].includes(request.method))return reply({error:'Method not allowed.'},405,{Allow:'GET, POST, DELETE'});
 if(request.method!=='GET'&&request.headers.get('Origin')!==origin)return reply({error:'Refresh the booth and try again.'},403);
 if(request.method==='DELETE')return reply({ok:true},200,{'Set-Cookie':selectionCookie('',0)});
 let code=selectedParty(request);
 if(request.method==='POST'){
  if(!env.LOGIN_LIMITER)return reply({error:'Party lookup is temporarily unavailable.'},503);
  if(!(await env.LOGIN_LIMITER.limit({key:'booth-select:'+request.headers.get('CF-Connecting-IP')})).success)return reply({error:'Too many attempts. Please wait a minute and try again.'},429);
  try{
   if(!request.headers.get('Content-Type')?.startsWith('application/json'))throw Error();
   const input=JSON.parse(await limitedText(request.body,128));if(!input||Object.keys(input).some(k=>k!=='code')||typeof input.code!=='string')throw Error();code=input.code;
  }catch{return reply({error:'Enter a 4–6 digit party code.'},400);}
 }
 if(!code)return reply({needsParty:true,error:'Enter your party code to open the booth.'},409);
 if(!PARTY_CODE_PATTERN.test(code)||!partyDirectory.has(code))return reply({needsParty:true,error:'That party code was not found. Check the code and try again.'},400);
 const partyUrl=partyDirectory.get(code);
 if(!/^https:\/\/[a-z0-9-]+\.idontthinkiwill\.com\/party\/$/.test(partyUrl))return reply({error:'This party is not available yet.'},503);
 try{
  // Public config only. Never forward administration, host or visitor cookies.
  const upstream=await fetcher(new URL('/api/photobooth/config',partyUrl).href,{headers:{Accept:'application/json'},redirect:'manual',signal:AbortSignal.timeout(15000)});
  if(upstream.status!==200||!upstream.headers.get('Content-Type')?.includes('application/json'))throw Error();
  const config=JSON.parse(await limitedText(upstream.body,16384));
  if(!/^[a-f0-9-]{36}$/.test(config.eventId)||typeof config.title!=='string'||!config.title.trim()||config.title.length>100||typeof config.features?.takePhoto!=='boolean'||typeof config.features?.enterContest!=='boolean'||typeof config.contestAvailable!=='boolean')throw Error();
  const contestUrl=new URL(partyUrl);contestUrl.searchParams.set('view','enter');contestUrl.searchParams.set('eventId',config.eventId);
  return reply({eventId:config.eventId,title:config.title,code,features:{takePhoto:config.features.takePhoto,enterContest:config.features.enterContest},contestAvailable:config.features.enterContest&&config.contestAvailable,contestMessage:typeof config.contestMessage==='string'?config.contestMessage.slice(0,160):'Contest submissions are unavailable.',contestUrl:contestUrl.href},200,request.method==='POST'?{'Set-Cookie':selectionCookie(code)}:{});
 }catch{return reply({error:'The party server is unavailable or waking up. Please try again shortly.'},503);}
}
