// These codes locate a party; they never grant host privileges or photo access.
export const PARTY_CODE_PATTERN=/^[0-9]{4,6}$/;
export const partyDirectory=new Map([['1234','https://geech.idontthinkiwill.com/party/']]);
export function generatePartyCode(usedCodes=partyDirectory.keys(),random=crypto){
 const used=new Set(usedCodes);
 for(let length=4;length<=6;length++){
  const space=10**length,ceiling=2**32-(2**32%space);
  for(let attempt=0;attempt<64;attempt++){
   let value;do{value=random.getRandomValues(new Uint32Array(1))[0];}while(value>=ceiling);
   const code=String(value%space).padStart(length,'0');if(!used.has(code))return code;
  }
 }
 throw new Error('No available party code. Try again later.');
}
export async function partyEntryRoute(request,env){
 const url=new URL(request.url);if(url.pathname!=='/party/enter'&&url.pathname!=='/party/enter/')return null;
 const {partyCodePage,partyPageHeaders}=await import('./party-page.js');
 const page=(message='',status=200)=>new Response(request.method==='HEAD'?null:partyCodePage(message),{status,headers:partyPageHeaders});
 if(url.pathname.endsWith('/'))return new Response(null,{status:308,headers:{...partyPageHeaders,Location:'/party/enter'}});
 if(['GET','HEAD'].includes(request.method))return page();
 if(request.method!=='POST')return new Response(null,{status:405,headers:{...partyPageHeaders,Allow:'GET, HEAD, POST'}});
 if(request.headers.get('Origin')!==url.origin)return page('Refresh this page and try again.',403);
 if(!env.LOGIN_LIMITER)return page('Party lookup is temporarily unavailable. Please try again later.',503);
 if(!(await env.LOGIN_LIMITER.limit({key:'party-entry:'+request.headers.get('CF-Connecting-IP')})).success)return page('Too many attempts. Please wait a minute and try again.',429);
 if(!request.headers.get('Content-Type')?.startsWith('application/x-www-form-urlencoded'))return page('Enter a valid party code.',400);
 const reader=request.body?.getReader();if(!reader)return page('Enter a valid party code.',400);
 const chunks=[];let size=0;for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>128){await reader.cancel();return page('Enter a valid party code.',413);}chunks.push(value);}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 const params=new URLSearchParams(new TextDecoder().decode(bytes)),code=params.get('code')||'';
 if(params.getAll('code').length!==1||!PARTY_CODE_PATTERN.test(code)||!partyDirectory.has(code))return page('That party code was not found. Check the code and try again.',400);
 return new Response(null,{status:303,headers:{...partyPageHeaders,Location:partyDirectory.get(code)}});
}
