import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {guestDemoPage} from './guest-demo-page.js';
const hash=v=>createHash('sha256').update(v).digest('hex'),token=()=>randomBytes(32).toString('hex');
const COOKIE='guest_demo',SESSION_MS=3600000,LINK_MS=600000;
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
function displayName(v){if(typeof v!=='string'||!v.trim()||v.trim().length>60||/[\u0000-\u001f\u007f]/.test(v))fail(400,'Enter a fictional display name up to 60 characters.');return v.trim();}
function fictionalEmail(v){const email=typeof v==='string'?v.trim().toLowerCase():'';if(!/^[a-z0-9][a-z0-9._+-]{0,63}@example\.test$/.test(email))fail(400,'Use a fictional address ending in @example.test. No email will be sent.');return email;}
function cookieValue(req){const matches=(req.headers.cookie||'').split(';').map(v=>v.trim()).filter(v=>v.startsWith(COOKIE+'='));const v=matches.length===1?matches[0].slice(COOKIE.length+1):'';return /^[a-f0-9]{64}$/.test(v)?v:null;}
// Separate tables and cookies: demo identities NEVER authorize votes, photos or host access.
export function installGuestDemo({app,db,enabled,production,now,active,limiter}){
 const page='/party/guest-demo/',api='/api/guest-demo';
 const available=(_req,res,next)=>enabled?next():res.status(404).json({error:'Not found.'});
 app.get(['/party/guest-demo',page],available,(req,res)=>{if(req.path!==page)return res.redirect(303,page);res.set('X-Robots-Tag','noindex, nofollow');res.type('html').send(guestDemoPage);});
 app.use(api,available);if(!enabled)return;
 db.exec(`CREATE TABLE IF NOT EXISTS demo_guests(id TEXT PRIMARY KEY,contest_id TEXT NOT NULL REFERENCES contests(id),email TEXT NOT NULL,display_name TEXT NOT NULL,created INTEGER NOT NULL,UNIQUE(contest_id,email),UNIQUE(id,contest_id));
 CREATE TABLE IF NOT EXISTS demo_guest_links(id TEXT PRIMARY KEY,contest_id TEXT NOT NULL REFERENCES contests(id),visitor_id TEXT NOT NULL UNIQUE REFERENCES visitors(id),email TEXT NOT NULL,display_name TEXT NOT NULL,expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS demo_guest_sessions(id TEXT PRIMARY KEY,guest_id TEXT NOT NULL,contest_id TEXT NOT NULL,visitor_id TEXT NOT NULL UNIQUE REFERENCES visitors(id),expires INTEGER NOT NULL,FOREIGN KEY(guest_id,contest_id) REFERENCES demo_guests(id,contest_id));`);
 const clearCookie=res=>res.clearCookie(COOKIE,{path:'/',httpOnly:true,secure:production,sameSite:'lax'});
 const currentSession=req=>{const value=cookieValue(req),c=active();if(!value||!req.visitor||!c)return null;return db.prepare(`SELECT g.id,g.display_name,s.expires FROM demo_guest_sessions s JOIN demo_guests g ON g.id=s.guest_id AND g.contest_id=s.contest_id WHERE s.id=? AND s.contest_id=? AND s.visitor_id=? AND s.expires>?`).get(hash(value),c.id,req.visitor.id,now());};
 const publicGuest=row=>row?{id:row.id,displayName:row.display_name,identity:'demo-only',emailVerified:false,expires:row.expires}:null;
 app.get(api+'/session',(req,res)=>{const c=active(),guest=currentSession(req);if(!guest)clearCookie(res);res.json({demo:true,csrf:req.visitor?.csrf,event:c?{id:c.id,title:c.title}:null,guest:publicGuest(guest)});});
 app.post(api+'/start',limiter(40,15*60000),(req,res)=>{
  const c=active();if(!c||req.body?.eventId!==c.id)fail(409,'The event changed. Reload the demo before signing in.');
  if(currentSession(req))fail(409,'Finish this guest session before switching guests.');
  const email=fictionalEmail(req.body?.email),name=displayName(req.body?.displayName);
  db.prepare('DELETE FROM demo_guest_links WHERE expires<=?').run(now());db.prepare('DELETE FROM demo_guest_sessions WHERE expires<=?').run(now());
  if(db.prepare('SELECT COUNT(*) n FROM demo_guests WHERE contest_id=?').get(c.id).n>=1000&&!db.prepare('SELECT 1 FROM demo_guests WHERE contest_id=? AND email=?').get(c.id,email))fail(409,'This test event has reached its demo guest limit.');
  const value=token();db.prepare(`INSERT INTO demo_guest_links VALUES (?,?,?,?,?,?) ON CONFLICT(visitor_id) DO UPDATE SET id=excluded.id,contest_id=excluded.contest_id,email=excluded.email,display_name=excluded.display_name,expires=excluded.expires`).run(hash(value),c.id,req.visitor.id,email,name,now()+LINK_MS);
  res.status(201).json({demo:true,emailSent:false,email,expires:now()+LINK_MS,verificationPath:page+'#verify='+value});
 });
 app.post(api+'/verify',limiter(60,15*60000),(req,res)=>{
  const value=req.body?.token,c=active();if(!c||req.body?.eventId!==c.id||typeof value!=='string'||!/^[a-f0-9]{64}$/.test(value))fail(400,'This demo link is invalid or expired. Request a new one.');
  db.exec('BEGIN IMMEDIATE');let sessionToken,guest;
  try{
   const link=db.prepare('SELECT * FROM demo_guest_links WHERE id=? AND contest_id=? AND visitor_id=? AND expires>?').get(hash(value),c.id,req.visitor.id,now());
   if(!link)fail(400,'This demo link is invalid or expired. Request a new one in the same browser.');
   guest=db.prepare('SELECT * FROM demo_guests WHERE contest_id=? AND email=?').get(c.id,link.email);
   if(!guest){if(db.prepare('SELECT COUNT(*) n FROM demo_guests WHERE contest_id=?').get(c.id).n>=1000)fail(409,'This test event has reached its demo guest limit.');guest={id:randomUUID(),display_name:link.display_name};db.prepare('INSERT INTO demo_guests VALUES (?,?,?,?,?)').run(guest.id,c.id,link.email,guest.display_name,now());}
   db.prepare('DELETE FROM demo_guest_links WHERE visitor_id=?').run(req.visitor.id);db.prepare('DELETE FROM demo_guest_sessions WHERE visitor_id=?').run(req.visitor.id);
   sessionToken=token();db.prepare('INSERT INTO demo_guest_sessions VALUES (?,?,?,?,?)').run(hash(sessionToken),guest.id,c.id,req.visitor.id,now()+SESSION_MS);db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
  res.cookie(COOKIE,sessionToken,{path:'/',httpOnly:true,secure:production,sameSite:'lax',maxAge:SESSION_MS});res.json({demo:true,guest:publicGuest({...guest,expires:now()+SESSION_MS})});
 });
 app.put(api+'/me',limiter(30),(req,res)=>{const guest=currentSession(req);if(!guest)fail(401,'Your demo session ended. Sign in again.');const name=displayName(req.body?.displayName);db.prepare('UPDATE demo_guests SET display_name=? WHERE id=? AND contest_id=?').run(name,guest.id,active().id);res.json({demo:true,guest:publicGuest({...guest,display_name:name})});});
 app.post(api+'/finish',(req,res)=>{db.prepare('DELETE FROM demo_guest_sessions WHERE visitor_id=?').run(req.visitor.id);db.prepare('DELETE FROM demo_guest_links WHERE visitor_id=?').run(req.visitor.id);clearCookie(res);res.json({ok:true,demo:true});});
}
