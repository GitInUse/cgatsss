import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import vm from 'node:vm';
import {generateKeyPair,exportJWK,SignJWT,EncryptJWT,base64url} from 'jose';
import {createHandler} from './worker.js';
const origin='https://idontthinkiwill.com',issuer='https://accounts.google.com',clientId='123-example.apps.googleusercontent.com',owner='owner@example.test',secret='test-google-client-secret-only';
const {privateKey,publicKey}=await generateKeyPair('RS256');
const jwk=await exportJWK(publicKey);jwk.kid='test-google-key';jwk.alg='RS256';jwk.use='sig';
const wrongKey=(await generateKeyPair('RS256')).privateKey;
function fixture(){
 const data=new Map(),codes=new Map(),calls=[];let claimsOverride={},mode='',limited=false,clock=Date.now();
 const env={GOOGLE_CLIENT_ID:clientId,GOOGLE_CLIENT_SECRET:secret,OWNER_EMAILS:JSON.stringify([owner,'backup@example.test']),LOGIN_LIMITER:{async limit(){return {success:!limited};}},ASSETS:{fetch:r=>new Response('static '+new URL(r.url).pathname)},NO_MEMES:{
 async list({prefix}){return {keys:[...data.keys()].filter(k=>k.startsWith(prefix)).map(name=>({name})),list_complete:true};},
 async put(k,value,o={}){data.set(k,{value,metadata:o.metadata,ttl:o.expirationTtl});},
 async get(k,type){const saved=data.get(k);return saved?(type==='json'?JSON.parse(saved.value):saved.value):null;},
 async delete(k){data.delete(k);},
 async getWithMetadata(k){return data.get(k)||{value:null};}
 }};
 const fetcher=async(input,options={})=>{
  const url=String(input);calls.push(url);assert.equal(options.redirect,'manual');
  if(url===issuer+'/.well-known/openid-configuration'&&mode==='redirect')return new Response(null,{status:302,headers:{Location:'https://evil.test'}});
  if(url===issuer+'/.well-known/openid-configuration')return Response.json({issuer,authorization_endpoint:issuer+'/o/oauth2/v2/auth',token_endpoint:'https://oauth2.googleapis.com/token',jwks_uri:'https://www.googleapis.com/oauth2/v3/certs',response_types_supported:['code'],subject_types_supported:['public'],id_token_signing_alg_values_supported:['RS256'],code_challenge_methods_supported:['S256'],token_endpoint_auth_methods_supported:['client_secret_post']});
  if(url==='https://www.googleapis.com/oauth2/v3/certs')return Response.json({keys:[jwk]});
  assert.equal(url,'https://oauth2.googleapis.com/token');
  const params=new URLSearchParams(options.body);assert.equal(params.get('client_id'),clientId);assert.equal(params.get('client_secret'),secret);assert.equal(params.get('redirect_uri'),origin+'/api/personal/google/callback');
  const record=codes.get(params.get('code'));codes.delete(params.get('code'));
  if(!record)return Response.json({error:'invalid_grant'},{status:400});
  const challenge=base64url.encode(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(params.get('code_verifier')))));assert.equal(challenge,record.challenge);
  const payload={iss:issuer,aud:clientId,sub:'google-owner-id',email:owner,email_verified:true,nonce:record.nonce,iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+3600,...claimsOverride};
  const jwt=await new SignJWT(payload).setProtectedHeader({alg:'RS256',kid:jwk.kid}).sign(mode==='bad-signature'?wrongKey:privateKey);
  return Response.json({access_token:'test-access-token',token_type:'Bearer',expires_in:3600,...(mode==='missing-id-token'?{}:{id_token:jwt})});
 };
 const handle=createHandler({fetcher,now:()=>clock});
 return {env,data,codes,calls,fetcher,handle,setClaims:value=>{claimsOverride=value;},setMode:value=>{mode=value;},limit:()=>{limited=true;},advance:ms=>{clock+=ms;}};
}
function req(path,method='GET',body,cookie='',extra={}){
 return new Request(origin+path,{method,headers:{...(method==='POST'?{Origin:origin,'X-Personal-Action':'1','X-No-Upload':'1'}:{}),...(cookie?{Cookie:cookie}:{}),...extra},body});
}
async function begin(f,next='/home'){
 const response=await f.handle(req('/api/personal/google/start?next='+encodeURIComponent(next)),f.env);assert.equal(response.status,303);
 const url=new URL(response.headers.get('Location'));assert.equal(url.origin,issuer);assert.equal(url.searchParams.get('scope'),'openid email');assert.equal(url.searchParams.get('code_challenge_method'),'S256');assert.equal(url.searchParams.get('redirect_uri'),origin+'/api/personal/google/callback');assert.equal(url.searchParams.get('prompt'),'select_account');assert.ok(!url.searchParams.has('login_hint'));
 const cookies=response.headers.getSetCookie();assert.equal(cookies.length,1);assert.match(cookies[0],/Secure; HttpOnly; SameSite=Lax; Max-Age=600/);
 const flow=cookies[0].split(';')[0],code=crypto.randomUUID();
 f.codes.set(code,{nonce:url.searchParams.get('nonce'),challenge:url.searchParams.get('code_challenge')});
 return {flow,path:'/api/personal/google/callback?code='+code+'&state='+url.searchParams.get('state')};
}
async function login(f,next='/home'){
 const started=await begin(f,next),response=await f.handle(req(started.path,'GET',undefined,started.flow),f.env);
 assert.equal(response.status,303);assert.equal(response.headers.get('Location'),next==='/noupload'?'/noupload':'/home');
 const cookies=response.headers.getSetCookie();assert.equal(cookies.length,2);
 const session=cookies.find(c=>c.startsWith('__Host-personal='));
 assert.match(session,/^__Host-personal=[a-f0-9]{64}; Path=\/; Secure; HttpOnly; SameSite=Lax; Max-Age=43200$/);
 assert.doesNotMatch(session,/owner@|google-owner|test-google/);
 return session.split(';')[0];
}
test('real OIDC/PKCE verification shares a private session across dashboard and uploader',async()=>{
 const f=fixture();
 for(const path of ['/home','/home/','/home.html','/noupload','/noupload/','/noupload.html']){
  assert.equal((await f.handle(req(path),f.env)).status,303);assert.equal((await f.handle(req(path,'HEAD'),f.env)).status,303);
 }
 const session=await login(f);
 for(const path of ['/home','/home.html','/noupload','/noupload.html']){
  const response=await f.handle(req(path,'GET',undefined,session),f.env);assert.equal(response.status,200);assert.match(response.headers.get('Cache-Control'),/no-store/);assert.match(response.headers.get('Content-Security-Policy'),/frame-ancestors 'none'/);
  const html=await response.text();assert.match(html,/Log out/);assert.doesNotMatch(html,/owner@example|backup@example|test-google-client|type="password"/);
 }
 assert.equal((await (await f.handle(req('/api/personal/session','GET',undefined,session),f.env)).json()).authenticated,true);
 assert.equal((await createHandler({fetcher:f.fetcher})(req('/home','GET',undefined,session),f.env)).status,200);
 assert.equal((await f.handle(req('/login?next=https://evil.test','GET',undefined,session),f.env)).headers.get('Location'),'/home');
 const logout=await f.handle(req('/api/personal/logout','POST',undefined,session),f.env);assert.equal(logout.status,200);assert.ok(logout.headers.getSetCookie().every(c=>c.includes('Max-Age=0')));
 assert.equal((await f.handle(req('/home','GET',undefined,session),f.env)).status,303);
 assert.equal((await f.handle(req('/api/no-admin/upload','POST',new FormData(),session),f.env)).status,401);
 const expired=await login(f);f.advance(13*3600000);assert.equal((await f.handle(req('/noupload','GET',undefined,expired),f.env)).status,303);
});
test('OIDC rejects bad signatures, wrong issuer/audience/nonce, expired tokens, unverified and unapproved emails',async()=>{
 const cases=[
  {mode:'bad-signature'},{mode:'missing-id-token'},
  {claims:{iss:'https://evil.test'}},{claims:{aud:'wrong-client'}},
  {claims:{nonce:'wrong-nonce'}},{claims:{exp:Math.floor(Date.now()/1000)-120}},
  {claims:{email:'stranger@example.test'}},{claims:{email_verified:false}}
 ];
 for(const value of cases){
  const f=fixture();if(value.mode)f.setMode(value.mode);if(value.claims)f.setClaims(value.claims);
  const started=await begin(f),response=await f.handle(req(started.path,'GET',undefined,started.flow),f.env);
  assert.equal(response.headers.get('Location'),'/login?error=sign-in',JSON.stringify(value));assert.ok(!response.headers.getSetCookie().some(c=>/^__Host-personal=.+/.test(c)));
  assert.equal([...f.data.keys()].filter(k=>k.startsWith('auth-session:')).length,0);
 }
});
test('OAuth state, transaction expiry and authorization-code reuse are checked; secrets and emails are never hinted',async()=>{
 const f=fixture(),started=await begin(f,'https://evil.test');
 assert.equal((await f.handle(req(started.path),f.env)).headers.get('Location'),'/login?error=sign-in');
 const wrongState=started.path.replace(/state=[^&]+/,'state=wrong');
 assert.equal((await f.handle(req(wrongState,'GET',undefined,started.flow),f.env)).headers.get('Location'),'/login?error=sign-in');
 const tampered=started.flow.slice(0,-12)+'AAAAAAAAAAAA';
 assert.equal((await f.handle(req(started.path,'GET',undefined,tampered),f.env)).headers.get('Location'),'/login?error=sign-in');
 const key=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode('dashboard-oauth-transaction:v1:'+secret)));
 const expired=await new EncryptJWT({state:'expired',nonce:'old',verifier:'old',next:'/home',version:'old'}).setProtectedHeader({alg:'dir',enc:'A256GCM'}).setIssuer(origin).setAudience('google-login').setIssuedAt(Math.floor(Date.now()/1000)-1200).setExpirationTime(Math.floor(Date.now()/1000)-600).encrypt(key);
 assert.equal((await f.handle(req(started.path,'GET',undefined,'__Host-google-flow='+expired),f.env)).headers.get('Location'),'/login?error=sign-in');
 const valid=await f.handle(req(started.path,'GET',undefined,started.flow),f.env);assert.equal(valid.headers.get('Location'),'/home');
 const replay=await f.handle(req(started.path,'GET',undefined,started.flow),f.env);assert.equal(replay.headers.get('Location'),'/login?error=sign-in');
 const html=await (await f.handle(req('/login?error=anything'),f.env)).text();assert.doesNotMatch(html,/owner@example|backup@example|test-google-client|type="password"/);
 f.limit();assert.equal((await f.handle(req('/api/personal/google/start'),f.env)).status,429);
});
test('configuration changes revoke sessions; old host cookies and fake identity headers do not grant access',async()=>{
 const f=fixture(),session=await login(f);
 f.env.OWNER_EMAILS=JSON.stringify(['backup@example.test']);
 assert.equal((await f.handle(req('/home','GET',undefined,session),f.env)).status,303);
 const old='host='+'a'.repeat(64)+'; __Host-no-upload='+'a'.repeat(64);
 assert.equal((await f.handle(req('/home','GET',undefined,old,{'Cf-Access-Authenticated-User-Email':owner,'Cf-Access-Jwt-Assertion':'fake'}),f.env)).status,303);
 delete f.env.GOOGLE_CLIENT_SECRET;
 assert.equal((await f.handle(req('/home'),f.env)).status,503);
 assert.equal((await f.handle(req('/'),f.env)).status,200);
 assert.equal((await (await f.handle(req('/api/no-memes'),f.env)).json()).memes.length,2);
 assert.equal((await f.handle(req('/api/personal/google/start'),f.env)).status,503);
 assert.equal(existsSync(new URL('./public/home.html',import.meta.url)),false);assert.equal(existsSync(new URL('./public/noupload.html',import.meta.url)),false);
});
test('authenticated uploads retain public rotation and storage; cross-site and anonymous writes are blocked',async()=>{
 const f=fixture(),session=await login(f,'/noupload');
 assert.equal((await f.handle(req('/api/no-admin/upload','POST',new FormData()),f.env)).status,401);
 assert.equal((await f.handle(req('/api/no-admin/upload','POST',new FormData(),session,{Origin:'https://evil.test'}),f.env)).status,403);
 assert.equal((await f.handle(req('/api/personal/logout','POST',undefined,session,{Origin:'https://evil.test'}),f.env)).status,403);
 const invalid=new FormData();invalid.append('image',new Blob(['<svg onload=alert(1)>'],{type:'image/png'}),'bad.png');
 assert.equal((await f.handle(req('/api/no-admin/upload','POST',invalid,session),f.env)).status,400);
 for(const [file,type] of [['no.gif','image/gif'],['bugs-no.png','image/png']]){
  const image=readFileSync(new URL('./public/assets/'+file,import.meta.url)),form=new FormData();form.append('image',new Blob([image],{type}),file);
  const response=await f.handle(req('/api/no-admin/upload','POST',form,session),f.env);assert.equal(response.status,201);
  const uploaded=await response.json(),publicImage=await f.handle(req(uploaded.url),f.env);assert.equal(publicImage.headers.get('Content-Type'),type);assert.deepEqual(Buffer.from(await publicImage.arrayBuffer()),image);
 }
 assert.equal((await (await f.handle(req('/api/no-memes'),f.env)).json()).memes.length,4);
 assert.equal((await (await createHandler({fetcher:f.fetcher})(req('/api/no-memes'),f.env)).json()).memes.length,4);
 assert.equal((await f.handle(req('/api/no-admin/upload','POST','x',session,{'Content-Length':String(10*1024*1024)}),f.env)).status,413);
});
test('root has no navigation and each load chooses only one meme without repeating the previous selection',async()=>{
 const html=readFileSync(new URL('./public/index.html',import.meta.url),'utf8');assert.doesNotMatch(html,/<a\b|\/home|noupload/);
 const values=new Map();let previous;
 for(let i=0;i<8;i++){
  const img={hidden:true};const context={document:{getElementById:()=>img},sessionStorage:{getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)},crypto:{getRandomValues:a=>{a[0]=i*100;return a;}},fetch:async()=>({ok:true,json:async()=>({memes:[{url:'/one.gif',alt:'No.'},{url:'/two.png',alt:'No.'},{url:'/three.jpg',alt:'No.'}]})}),Uint32Array,Math};
  await vm.runInNewContext(readFileSync(new URL('./public/meme.js',import.meta.url),'utf8'),context);assert.equal(img.hidden,false);assert.ok(img.src);assert.notEqual(img.src,previous);previous=img.src;
 }
});

test('only owner can remove and restore uploaded and starter memes across handler restarts',async()=>{
 const f=fixture(),session=await login(f);
 assert.equal((await f.handle(req('/api/no-admin/library'),f.env)).status,401);
 for(const id of ['seed-0','seed-1']){
  assert.equal((await f.handle(req('/api/no-admin/delete','POST',JSON.stringify({id})),f.env)).status,401);
  assert.equal((await f.handle(req('/api/no-admin/delete','POST',JSON.stringify({id}),session,{Origin:'https://evil.test'}),f.env)).status,403);
  assert.equal((await f.handle(req('/api/no-admin/delete','POST',JSON.stringify({id}),session),f.env)).status,200);
 }
 assert.equal((await (await createHandler({fetcher:f.fetcher})(req('/api/no-memes'),f.env)).json()).memes.length,0);
 const library=await (await f.handle(req('/api/no-admin/library','GET',undefined,session),f.env)).json();assert.equal(library.memes.length,2);assert.ok(library.memes.every(m=>m.deleted));
 assert.equal((await f.handle(req('/api/no-admin/restore','POST',JSON.stringify({id:'seed-0'}),session),f.env)).status,200);
 assert.equal((await (await f.handle(req('/api/no-memes'),f.env)).json()).memes.length,1);
 const form=new FormData();form.append('image',new Blob([readFileSync(new URL('./public/assets/no.gif',import.meta.url))],{type:'image/gif'}),'no.gif');
 const uploaded=await (await f.handle(req('/api/no-admin/upload','POST',form,session),f.env)).json();const id=uploaded.url.split('/').pop();
 assert.equal((await f.handle(req('/api/no-admin/delete','POST',JSON.stringify({id}),session),f.env)).status,200);assert.ok(f.data.has('image:'+id));
 assert.equal((await f.handle(req('/api/no-admin/restore','POST',JSON.stringify({id}),session),f.env)).status,200);
 assert.equal((await (await f.handle(req('/api/no-memes'),f.env)).json()).memes.length,2);
});

test('Workers-compatible identity requests never follow redirects or expose secrets in failures',async()=>{const f=fixture();f.setMode('redirect');const response=await f.handle(req('/api/personal/google/start'),f.env);assert.equal(response.status,503);assert.doesNotMatch(await response.text(),/test-google-client|owner@example/);assert.deepEqual(f.calls,[issuer+'/.well-known/openid-configuration']);});

test('standalone photo booth is public, canonical and device-only without changing private login or root memes',async()=>{
 const f=fixture();delete f.env.GOOGLE_CLIENT_SECRET;
 for(const method of ['GET','HEAD']){const response=await f.handle(req('/photobooth',method),f.env);assert.equal(response.status,200);assert.match(response.headers.get('Content-Security-Policy'),/connect-src 'none'/);assert.match(response.headers.get('Permissions-Policy'),/camera=\(self\).*microphone=\(\)/);const html=await response.text();if(method==='HEAD')assert.equal(html,'');else{assert.match(html,/\/photobooth\/controller.js/);assert.doesNotMatch(html,/geech\.|href="\/home|href="\/party/);assert.match(html,/No upload/);}}
 for(const path of ['/photobooth/','/photobooth.html']){const response=await f.handle(req(path),f.env);assert.equal(response.status,308);assert.equal(response.headers.get('Location'),'/photobooth');}
 assert.equal((await f.handle(req('/photobooth','POST','{}'),f.env)).status,405);
 assert.equal((await f.handle(req('/home'),f.env)).status,503);
});
