import * as oidc from 'openid-client';
import {EncryptJWT,jwtDecrypt} from 'jose';
import {privatePage,loginPage} from './private-pages.js';
import {dealPage} from './deal-page.js';

const ORIGIN='https://idontthinkiwill.com',ISSUER='https://accounts.google.com';
const CALLBACK=ORIGIN+'/api/personal/google/callback',SESSION='__Host-personal',FLOW='__Host-google-flow',TTL=43200;
const encoder=new TextEncoder();
const security={
 'Cache-Control':'no-store, private, max-age=0','Pragma':'no-cache','Vary':'Cookie',
 'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY',
 'Content-Security-Policy':"default-src 'self'; img-src 'self' blob:; style-src 'self'; script-src 'self'; connect-src 'self'; form-action 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
 'X-Robots-Tag':'noindex, nofollow'
};
export const privateResponse=(body,status=200,headers={})=>new Response(body,{status,headers:{...security,...headers}});
const json=(body,status=200)=>privateResponse(JSON.stringify(body),status,{'Content-Type':'application/json'});
const redirect=path=>privateResponse(null,303,{Location:path});
const cookie=(name,value,age)=>name+'='+value+'; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age='+age;
const withCookies=(response,...values)=>{for(const value of values)response.headers.append('Set-Cookie',value);return response;};
const bytesToHex=value=>Array.from(new Uint8Array(value),b=>b.toString(16).padStart(2,'0')).join('');
const digest=async value=>bytesToHex(await crypto.subtle.digest('SHA-256',encoder.encode(value)));
function getCookie(request,name){
 const values=(request.headers.get('Cookie')||'').split(';').map(v=>v.trim()).filter(v=>v.startsWith(name+'='));
 return values.length===1?values[0].slice(name.length+1):null;
}
export const safeDestination=value=>value==='/noupload'?'/noupload':'/home';
export function googleConfiguration(env){
 if(!/^[a-z0-9-]+\.apps\.googleusercontent\.com$/.test(env.GOOGLE_CLIENT_ID||'')||typeof env.GOOGLE_CLIENT_SECRET!=='string'||env.GOOGLE_CLIENT_SECRET.length<16||!env.NO_MEMES||!env.LOGIN_LIMITER)return null;
 let emails;try{emails=JSON.parse(env.OWNER_EMAILS);}catch{return null;}
 if(!Array.isArray(emails)||emails.length<1||emails.length>2||emails.some(e=>typeof e!=='string'||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)))return null;
 emails=emails.map(e=>e.toLowerCase());if(new Set(emails).size!==emails.length)return null;
 return {id:env.GOOGLE_CLIENT_ID,secret:env.GOOGLE_CLIENT_SECRET,emails};
}

// Google authenticates the owner. openid-client performs the standard OIDC/PKCE
// checks. jose encrypts the short-lived browser transaction; no new crypto is invented.
export function createPersonalAuth({fetcher=fetch,now=()=>Date.now()}={}){
 let cached;
 const approvedEndpoints=new Set([
  ISSUER+'/.well-known/openid-configuration',
  'https://oauth2.googleapis.com/token',
  'https://www.googleapis.com/oauth2/v3/certs'
 ]);
 const fetchGoogle=async(url,options)=>{
  if(!approvedEndpoints.has(String(url)))throw Error('Unexpected identity endpoint.');
  // Workers supports manual, not the Fetch redirect:error mode. Never follow identity redirects.
  const response=await fetcher(url,{...options,redirect:'manual',signal:AbortSignal.timeout(10000)});
  if(response.status>=300&&response.status<400)throw Error('Unexpected identity redirect.');
  return response;
 };
 async function identity(config){
  const version=await digest(JSON.stringify([config.id,config.secret,config.emails]));
  if(cached?.version===version)return cached;
  const google=await oidc.discovery(new URL(ISSUER),config.id,{client_secret:config.secret,id_token_signed_response_alg:'RS256'},oidc.ClientSecretPost(config.secret),{[oidc.customFetch]:fetchGoogle,timeout:10});
  oidc.enableNonRepudiationChecks(google);
  const key=new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode('dashboard-oauth-transaction:v1:'+config.secret)));
  cached={google,version,key};return cached;
 }
 async function versionOf(config){return digest(JSON.stringify([config.id,config.secret,config.emails]));}
 async function personalSession(request,env){
  const config=googleConfiguration(env),token=getCookie(request,SESSION);
  if(!config||!token||!/^[a-f0-9]{64}$/.test(token))return false;
  const saved=await env.NO_MEMES.get('auth-session:'+await digest(token),'json');
  return !!saved&&Number.isFinite(saved.expires)&&saved.expires>now()&&saved.version===await versionOf(config)&&typeof saved.sub==='string'&&config.emails.includes(saved.email);
 }
 async function limited(env,key){return (await env.LOGIN_LIMITER.limit({key})).success;}
 async function personalRoutes(request,env){
  const url=new URL(request.url),path=url.pathname;
  const deals=['/deals','/deals/'].includes(path),home=['/home','/home/','/home.html'].includes(path),upload=['/noupload','/noupload/','/noupload.html'].includes(path),login=['/login','/login/','/login.html'].includes(path),api=path.startsWith('/api/personal/');
  if(!home&&!upload&&!login&&!deals&&!api)return null;
  if(url.origin!==ORIGIN)return json({error:'Use the main website to sign in.'},403);
  const config=googleConfiguration(env);
  if(home||upload||login||deals){
   if(!['GET','HEAD'].includes(request.method))return json({error:'Method not allowed.'},405);
   const signedIn=await personalSession(request,env);
   if(home||upload||deals){
    if(!signedIn)return config?redirect('/login?next='+encodeURIComponent(upload?'/noupload':'/home')):privateResponse(request.method==='HEAD'?null:loginPage(false),503,{'Content-Type':'text/html; charset=utf-8'});
    return privateResponse(request.method==='HEAD'?null:(deals?dealPage:privatePage(upload?'upload':'home')),200,{'Content-Type':'text/html; charset=utf-8'});
   }
   if(signedIn)return redirect(safeDestination(url.searchParams.get('next')));
   return privateResponse(request.method==='HEAD'?null:loginPage(!!config,safeDestination(url.searchParams.get('next')),url.searchParams.has('error')),200,{'Content-Type':'text/html; charset=utf-8'});
  }
  if(path==='/api/personal/deals'&&request.method==='GET'){
   if(!await personalSession(request,env))return json({error:'Sign in required.'},401);
   // Private read-only feed. A future verified deal collector can write this KV key.
   let saved = [];
   if (env.NO_MEMES) {
    try { const value = await env.NO_MEMES.get('deal-hunter:feed','json'); if (Array.isArray(value)) saved = value.slice(0,100).filter(d => d && typeof d.name==='string' && typeof d.price==='string' && typeof d.url==='string' && /^https:\\/\\//.test(d.url)).map(d => ({name:d.name.slice(0,130),description:String(d.description||'').slice(0,140),price:d.price.slice(0,32),typicalPrice:String(d.typicalPrice||'').slice(0,32),discount:String(d.discount||'').slice(0,25),conditions:String(d.conditions||'').slice(0,160),retailer:String(d.retailer||'').slice(0,50),category:String(d.category||'').slice(0,30),url:d.url.slice(0,1000)})); } catch { /* Failed or malformed feed: show no unverified offers. */ }
   }
   return json({deals:saved});
  }
  if(path==='/api/personal/session'&&request.method==='GET')return json({authenticated:await personalSession(request,env),configured:!!config,storageReady:!!env.NO_MEMES});
  if(path==='/api/personal/google/start'&&request.method==='GET'){
   if(!config)return json({error:'Google sign-in is awaiting private setup.'},503);
   if(!await limited(env,'google-start'))return json({error:'Please wait a minute before trying again.'},429);
   const next=safeDestination(url.searchParams.get('next'));
   if(await personalSession(request,env))return redirect(next);
   let prepared;try{prepared=await identity(config);}catch(error){const code=typeof error.code==='string'&&/^[A-Z_]{3,80}$/.test(error.code)?error.code:error.message==='Unexpected identity endpoint.'?'ENDPOINT_BLOCKED':error.name==='TypeError'?'TYPE_ERROR':'DISCOVERY_FAILED';return json({error:'Google sign-in could not start. Please try again.',reference:code},503);}
   const {google,key,version}=prepared;
   const verifier=oidc.randomPKCECodeVerifier(),state=oidc.randomState(),nonce=oidc.randomNonce();
   const flow=await new EncryptJWT({verifier,state,nonce,next,version}).setProtectedHeader({alg:'dir',enc:'A256GCM'}).setIssuer(ORIGIN).setAudience('google-login').setIssuedAt().setExpirationTime('10m').encrypt(key);
   const target=oidc.buildAuthorizationUrl(google,{redirect_uri:CALLBACK,scope:'openid email',response_type:'code',code_challenge:await oidc.calculatePKCECodeChallenge(verifier),code_challenge_method:'S256',state,nonce,prompt:'select_account'});
   return withCookies(redirect(target.href),cookie(FLOW,flow,600));
  }
  if(path==='/api/personal/google/callback'&&request.method==='GET'){
   try{
    if(!config||!await limited(env,'google-callback'))throw Error('Not ready.');
    const flow=getCookie(request,FLOW);if(!flow||flow.length>4096)throw Error('Missing transaction.');
    const {google,key,version}=await identity(config);
    const {payload}=await jwtDecrypt(flow,key,{issuer:ORIGIN,audience:'google-login',keyManagementAlgorithms:['dir'],contentEncryptionAlgorithms:['A256GCM'],requiredClaims:['exp','iat']});
    if(payload.version!==version||typeof payload.verifier!=='string'||typeof payload.nonce!=='string'||typeof payload.state!=='string')throw Error('Invalid transaction.');
    const tokens=await oidc.authorizationCodeGrant(google,url,{pkceCodeVerifier:payload.verifier,expectedState:payload.state,expectedNonce:payload.nonce,idTokenExpected:true});
    const claims=tokens.claims();
    if(!claims||claims.email_verified!==true||typeof claims.email!=='string'||typeof claims.sub!=='string'||!claims.sub||!config.emails.includes(claims.email.toLowerCase()))throw Error('Not permitted.');
    const token=bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
    await env.NO_MEMES.put('auth-session:'+await digest(token),JSON.stringify({expires:now()+TTL*1000,version,sub:claims.sub,email:claims.email.toLowerCase()}),{expirationTtl:TTL});
    return withCookies(redirect(safeDestination(payload.next)),cookie(FLOW,'',0),cookie(SESSION,token,TTL));
   }catch{return withCookies(redirect('/login?error=sign-in'),cookie(FLOW,'',0));}
  }
  if(request.method!=='POST')return json({error:'Not found.'},404);
  if(request.headers.get('Origin')!==ORIGIN||request.headers.get('X-Personal-Action')!=='1')return json({error:'Refresh this page and try again.'},403);
  if(path==='/api/personal/logout'){
   const token=getCookie(request,SESSION);
   if(token&&/^[a-f0-9]{64}$/.test(token)&&env.NO_MEMES)await env.NO_MEMES.delete('auth-session:'+await digest(token));
   return withCookies(json({ok:true}),cookie(SESSION,'',0),cookie(FLOW,'',0));
  }
  return json({error:'Use Sign in with Google.'},410);
 }
 return {personalSession,personalRoutes};
}
