import express from 'express';
import { rateLimit } from 'express-rate-limit';
import multer from 'multer';
import sharp from 'sharp';
import { DateTime, IANAZone } from 'luxon';
import archiver from 'archiver';
import QRCode from 'qrcode';
import { DatabaseSync, backup } from 'node:sqlite';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, existsSync, statSync, readdirSync, unlinkSync, readFileSync, renameSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
sharp.concurrency(1);
sharp.cache({ memory: 16, files: 0, items: 20 });
const hash = s => createHash('sha256').update(s).digest('hex');
const token = () => randomBytes(32).toString('hex');
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const text = (v, max = 120, required = false) => {
  if (typeof v !== 'string' || v.trim().length > max || (required && !v.trim())) fail(400, 'Please check the text and its length.');
  return v.trim();
};
export function phase(contest, now = Date.now()) {
  if (!contest || contest.archived) return 'closed';
  const s = contest.settings;
  if (s.override === 'closed') return 'closed';
  if (!s.start || !s.entriesClose || !s.end) return 'scheduled';
  if (now < Date.parse(s.start)) return 'scheduled';
  if (now >= Date.parse(s.end)) return 'closed';
  return now < Date.parse(s.entriesClose) ? 'live' : 'voting_only';
}
export function openDatabase(dir) {
  mkdirSync(path.join(dir, 'photos'), { recursive: true });
  const db = new DatabaseSync(path.join(dir, 'party.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS contests (id TEXT PRIMARY KEY, title TEXT NOT NULL, settings TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0, created TEXT NOT NULL);
    CREATE UNIQUE INDEX IF NOT EXISTS one_current ON contests(archived) WHERE archived=0;
    CREATE TABLE IF NOT EXISTS entries (id TEXT PRIMARY KEY, contest_id TEXT NOT NULL REFERENCES contests(id), name TEXT NOT NULL, category TEXT NOT NULL, caption TEXT NOT NULL, photo TEXT NOT NULL, owner TEXT NOT NULL, hidden INTEGER NOT NULL DEFAULT 0, created TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS votes (contest_id TEXT NOT NULL REFERENCES contests(id), category TEXT NOT NULL, voter TEXT NOT NULL, entry_id TEXT NOT NULL REFERENCES entries(id), PRIMARY KEY(contest_id, category, voter));
    CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, contest_id TEXT NOT NULL REFERENCES contests(id), author TEXT NOT NULL, message TEXT NOT NULL, hidden INTEGER NOT NULL DEFAULT 0, created TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS winners (contest_id TEXT NOT NULL REFERENCES contests(id), category TEXT NOT NULL, entry_id TEXT NOT NULL REFERENCES entries(id), published TEXT NOT NULL, PRIMARY KEY(contest_id, category));
    CREATE TABLE IF NOT EXISTS visitors (id TEXT PRIMARY KEY, csrf TEXT NOT NULL, created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS party_transitions (next_id TEXT PRIMARY KEY REFERENCES contests(id), previous_id TEXT NOT NULL REFERENCES contests(id), undone INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS party_start_requests (id TEXT PRIMARY KEY, contest_id TEXT NOT NULL REFERENCES contests(id));
    PRAGMA user_version=1;`);
  return db;
}
export async function databaseBackup(db, dir, time = Date.now()) {
  const folder = path.join(dir, 'backups'); mkdirSync(folder, { recursive: true });
  const day = new Date(time).toISOString().slice(0, 10);
  const file = path.join(folder, `${day}.sqlite`);
  if (!existsSync(file)) {
    const temporary=`${file}.${randomUUID()}.partial`;
    try{await backup(db,temporary);renameSync(temporary,file);}
    finally{if(existsSync(temporary))unlinkSync(temporary);}
  }
  for (const name of readdirSync(folder)) {
    if (/^\d{4}-\d{2}-\d{2}\.sqlite$/.test(name) && Date.parse(name.slice(0,10)) < time - 14*86400000) unlinkSync(path.join(folder, name));
  }
}
export function isPersistentPath(dataDir,mountPath,mountInfo){
  const expected=path.posix.resolve(mountPath),data=path.posix.resolve(dataDir);
  if(expected==='/'||!(data===expected||data.startsWith(expected+'/')))return false;
  return mountInfo.split('\n').some(line=>line.split(' ')[4]?.replace(/\\([0-7]{3})/g,(_,octal)=>String.fromCharCode(parseInt(octal,8)))===expected);
}
function resolveStoragePath(dir){
  let ancestor=dir;const missing=[];
  while(!existsSync(ancestor)){const parent=path.dirname(ancestor);if(parent===ancestor)break;missing.unshift(path.basename(ancestor));ancestor=parent;}
  return path.join(realpathSync(ancestor),...missing);
}
export function createApp(options = {}) {
  const dataDir = path.resolve(options.dataDir || process.env.DATA_DIR || path.join(root, 'data'));
  const privateRelative=path.relative(realpathSync(path.join(root,'public')),resolveStoragePath(dataDir));
  if(privateRelative===''||(!privateRelative.startsWith('..'+path.sep)&&privateRelative!=='..'&&!path.isAbsolute(privateRelative)))throw new Error('DATA_DIR must be outside public/. Database files and uploads must stay private.');
  const production = options.production ?? process.env.NODE_ENV === 'production';
  const demoMode = process.env.DEMO_MODE === 'true';
  const localPreview = options.localPreview === true && !production;
  const password = options.password ?? (demoMode ? '1031' : process.env.HOST_PASSWORD ?? (localPreview ? '1031' : undefined));
  const validPreviewPin = (localPreview || demoMode) && /^\d{4,8}$/.test(password || '');
  if (!password || (password.length < 12 && !validPreviewPin)) throw new Error('Set HOST_PASSWORD to a unique password of at least 12 characters.');
  const origin = options.origin || process.env.PUBLIC_ORIGIN || (production && process.env.RENDER_EXTERNAL_URL);
  if(production){
    try{const url=new URL(origin);if(url.protocol!=='https:'||url.origin!==origin)throw new Error();}
    catch{throw new Error('Set PUBLIC_ORIGIN to the exact https website origin (no trailing slash).');}
  }
  if (production && ((process.env.RENDER && !demoMode) || process.env.REQUIRE_PERSISTENT_DISK==='true')) {
    const mountPath=process.env.PERSISTENT_DISK_PATH||'/var/data';
    if(process.platform!=='linux'||!isPersistentPath(dataDir,mountPath,readFileSync('/proc/self/mountinfo','utf8')))throw new Error('Persistent disk is missing. Mount the Render disk at PERSISTENT_DISK_PATH and keep DATA_DIR within it before deploying.');
  }
  const salt = randomBytes(16);
  let passwordSalt=salt,passwordHash=scryptSync(password,salt,64);
  const readRecoveryCode = () => options.recoveryCodeFile ? readFileSync(options.recoveryCodeFile, 'utf8').trim() : options.recoveryCode ?? process.env.HOST_RECOVERY_CODE;
  let recoveryCode, recoveryHash;
  const currentRecoveryHash = () => {
    const code = readRecoveryCode();
    if(production&&!code)throw new Error('Set HOST_RECOVERY_CODE privately in the hosting environment.');
    if (code && (code.length < 8 || code.length > 128)) throw new Error('HOST_RECOVERY_CODE must have 8–128 characters.');
    if (code !== recoveryCode) { recoveryCode = code; recoveryHash = code ? scryptSync(code, salt, 64) : null; }
    return recoveryHash;
  };
  currentRecoveryHash();
  const now = options.now || (() => Date.now());
  const db = openDatabase(dataDir);
  db.exec('CREATE TABLE IF NOT EXISTS host_credentials (id INTEGER PRIMARY KEY CHECK(id=1), salt TEXT NOT NULL, hash TEXT NOT NULL)');
  const savedPassword=db.prepare('SELECT salt,hash FROM host_credentials WHERE id=1').get();
  if(savedPassword){passwordSalt=Buffer.from(savedPassword.salt,'hex');passwordHash=Buffer.from(savedPassword.hash,'hex');}
  // Redeploys and password changes invalidate existing host sessions.
  db.prepare('DELETE FROM sessions').run();
  const app = express();
  app.disable('x-powered-by'); app.disable('etag');
  if (production) app.set('trust proxy', 1);
  app.locals.db = db; app.locals.dataDir = dataDir;
  const getContest = id => {
    const row = id ? db.prepare('SELECT * FROM contests WHERE id=?').get(id) : db.prepare('SELECT * FROM contests WHERE archived=0').get();
    return row && { ...row, settings: JSON.parse(row.settings) };
  };
  const active = () => getContest();
  const isOpen = c => ['live', 'voting_only'].includes(phase(c, now()));
  const photoUrl = id => `/api/photos/${id}`;
  const entryRows = id => db.prepare(`SELECT e.*, (SELECT COUNT(*) FROM votes v WHERE v.entry_id=e.id) AS votes FROM entries e WHERE contest_id=? ORDER BY created DESC`).all(id);
  const entryView = (e, host = false, viewer = '') => ({ id: e.id, contestId: e.contest_id, name: e.name, category: e.category, caption: e.caption, photoUrl: photoUrl(e.id), canEdit: host || e.owner === viewer, ...(host ? { votes: e.votes, hidden: !!e.hidden } : {}) });
  const undoInfo = c => {
    if(!c)return null;
    const row=db.prepare('SELECT t.previous_id,c.title FROM party_transitions t JOIN contests c ON c.id=t.previous_id WHERE t.next_id=? AND t.undone=0 AND c.archived=1').get(c.id);
    if(!row)return null;
    const activity=['entries','votes','messages'].some(table=>db.prepare(`SELECT 1 FROM ${table} WHERE contest_id=? LIMIT 1`).get(c.id));
    return {currentId:c.id,previousId:row.previous_id,previousTitle:row.title,enabled:!activity,reason:activity?'Undo is unavailable because this party already has photos, votes or messages.':'Undo restores the previous party as closed and keeps this empty party in your private archive.'};
  };
  app.use((req, res, next) => {
    res.set({ 'Cache-Control': 'no-store, private, max-age=0', 'Pragma': 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY', 'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'" });
    if (production) res.set('Strict-Transport-Security', 'max-age=31536000');
    if(production&&req.path!=='/healthz'&&['GET','HEAD'].includes(req.method)&&req.get('host')!==new URL(origin).host)return res.redirect(308,origin+req.originalUrl);
    const cookies = Object.fromEntries((req.headers.cookie || '').split(';').map(v => v.trim().split('=')));
    req.hostAuth = /^[a-f0-9]{64}$/.test(cookies.host || '') && !!db.prepare('SELECT id FROM sessions WHERE id=? AND expires>?').get(hash(cookies.host), now());
    let visitor = /^[a-f0-9]{64}$/.test(cookies.visitor || '') && db.prepare('SELECT * FROM visitors WHERE id=?').get(hash(cookies.visitor));
    if (!visitor && req.path === '/api/state') {
      const v = token(); visitor = { id: hash(v), csrf: token(), created: now() };
      db.prepare('INSERT INTO visitors VALUES (?,?,?)').run(visitor.id, visitor.csrf, visitor.created);
      res.cookie('visitor', v, { httpOnly: true, secure: production, sameSite: 'lax', path: '/', maxAge: 400 * 86400000 });
    }
    req.visitor = visitor;
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const expected = origin || `${req.protocol}://${req.get('host')}`;
      if (req.get('origin') !== expected || !visitor || req.get('x-csrf-token') !== visitor.csrf) return res.status(403).json({ error: 'Session expired. Refresh this page and try again.' });
    }
    next();
  });
  const limiter = (limit, windowMs = 60000) => rateLimit({ windowMs, limit: options.testing ? 10000 : limit, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Too many requests. Please wait a moment.' } });
  app.use('/api', limiter(300));
  app.use(express.json({ limit: '64kb' }));
  const hostOnly = (req, res, next) => req.hostAuth ? next() : res.status(401).json({ error: 'Host login required.' });
  app.get('/healthz', (req, res) => { db.prepare('SELECT 1').get(); res.json({ ok: true }); });
  app.get('/api/state', (req, res) => {
    const c = active(), currentPhase = phase(c, now());
    const visible = c && (req.hostAuth || isOpen(c));
    const winners = db.prepare(`SELECT e.*, c.title, w.published FROM winners w JOIN entries e ON e.id=w.entry_id JOIN contests c ON c.id=w.contest_id ORDER BY w.published DESC`).all().map(e => ({ ...entryView(e), contestTitle: e.title }));
    res.json({ csrf: req.visitor.csrf, host: !!req.hostAuth, localPreview, demoMode, serverTime: now(), phase: currentPhase,
      contest: c ? { id: c.id, title: c.title, settings: c.settings } : null,
      entries: visible ? entryRows(c.id).filter(e => req.hostAuth || !e.hidden).map(e => entryView(e, req.hostAuth, req.visitor.id)) : [],
      messages: visible ? db.prepare(`SELECT id, author, message, hidden FROM messages WHERE contest_id=? ${req.hostAuth ? '' : 'AND hidden=0'} ORDER BY created DESC LIMIT 100`).all(c.id) : [],
      myVotes: c ? db.prepare('SELECT category, entry_id AS entryId FROM votes WHERE contest_id=? AND voter=?').all(c.id, req.visitor.id) : [],
      winners, ...(req.hostAuth?{nextPartyUndo:undoInfo(c)}:{}) });
  });
  const grantHostSession = (req, res) => {
    const id = token(); db.prepare('DELETE FROM sessions WHERE expires<?').run(now());
    db.prepare('INSERT INTO sessions VALUES (?,?)').run(hash(id), now() + 12 * 3600000);
    res.cookie('host', id, { httpOnly: true, secure: production, sameSite: 'strict', path: '/', maxAge: 12 * 3600000 }); res.json({ ok: true });
  };
  app.post('/api/login', limiter(8, 15 * 60000), (req, res) => {
    if (typeof req.body.password !== 'string' || req.body.password.length > 256) fail(401, 'Incorrect host password.');
    const candidate=scryptSync(req.body.password, passwordSalt, 64), recovery=currentRecoveryHash();
    if (!timingSafeEqual(candidate,passwordHash) && !(recovery && timingSafeEqual(scryptSync(req.body.password,salt,64),recovery))) fail(401, 'Incorrect host password.');
    grantHostSession(req, res);
  });
  app.post('/api/recovery-login', limiter(5, 15 * 60000), (req, res) => {
    const recovery=currentRecoveryHash();
    if (!recovery || typeof req.body.code !== 'string' || req.body.code.length > 128 || !timingSafeEqual(scryptSync(req.body.code, salt, 64), recovery)) fail(401, 'Recovery code was not accepted. Check the saved code or the host server configuration.');
    grantHostSession(req, res);
  });
  app.post('/api/logout', (req, res) => {
    const host = (req.headers.cookie || '').match(/(?:^|;\s*)host=([a-f0-9]{64})/);
    if (host) db.prepare('DELETE FROM sessions WHERE id=?').run(hash(host[1]));
    res.clearCookie('host', { path: '/', httpOnly: true, secure: production, sameSite: 'strict' }); res.json({ ok: true });
  });
  const validateSettings = input => {
    const zone = text(input.timezone || 'America/Chicago', 80, true);
    if (!IANAZone.isValidZone(zone)) fail(400, 'Choose a valid timezone, such as America/Chicago.');
    const dates = ['start', 'entriesClose', 'end'].map(key => {
      const value = text(input[key], 40, true);
      const d = DateTime.fromISO(value, { zone });
      if (!d.isValid) fail(400, 'Please enter valid dates.');
      // A nonexistent daylight-saving time must not silently move the party time.
      if (!/[zZ]|[+-]\d\d:\d\d$/.test(value) && d.toFormat("yyyy-MM-dd'T'HH:mm") !== value.slice(0, 16)) fail(400, 'That local time does not exist because of daylight saving time.');
      return d.toUTC().toISO();
    });
    if (!(Date.parse(dates[0]) < Date.parse(dates[1]) && Date.parse(dates[1]) <= Date.parse(dates[2]))) fail(400, 'Start must be before entry closing, which must be at or before event closing.');
    if (!Array.isArray(input.categories) || input.categories.length < 1 || input.categories.length > 20) fail(400, 'Choose 1–20 categories.');
    const cats = input.categories.map(c => text(c, 60, true));
    if (new Set(cats.map(c => c.toLowerCase())).size !== cats.length) fail(400, 'Category names must be unique.');
    if (!['guest', 'host_only', 'hybrid'].includes(input.submissionMode)) fail(400, 'Invalid submission mode.');
    return { timezone: zone, start: dates[0], entriesClose: dates[1], end: dates[2], categories: cats, submissionMode: input.submissionMode, tagline: text(input.tagline ?? 'Eat. Drink. Claim the Belt.', 120), announcement: text(input.announcement || '', 300), theme: input.theme === 'neutral' ? 'neutral' : 'halloween', override: input.override === 'closed' ? 'closed' : 'auto' };
  };
  app.post('/api/host/password',hostOnly,(req,res)=>{
    const value=req.body.password;
    if(typeof value!=='string'||value.length>256||!(value.length>=12||(localPreview&&/^\d{4,8}$/.test(value))))fail(400,localPreview?'Use a 4–8 digit PIN or a password of at least 12 characters.':'Use a password of at least 12 characters.');
    const nextSalt=randomBytes(16),nextHash=scryptSync(value,nextSalt,64);
    db.prepare('INSERT INTO host_credentials VALUES (1,?,?) ON CONFLICT(id) DO UPDATE SET salt=excluded.salt,hash=excluded.hash').run(nextSalt.toString('hex'),nextHash.toString('hex'));
    passwordSalt=nextSalt;passwordHash=nextHash;
    db.prepare('DELETE FROM sessions').run();grantHostSession(req,res);
  });
  app.get('/api/host/contests', hostOnly, (req, res) => res.json(db.prepare('SELECT * FROM contests ORDER BY created DESC').all().map(c => ({ ...c, settings: JSON.parse(c.settings) }))));
  app.post('/api/host/contests', hostOnly, (req, res) => {
    const title = text(req.body.title, 100, true), settings = validateSettings(req.body.settings), id = randomUUID();
    const requestId=text(req.body.requestId,100,true);
    db.exec('BEGIN IMMEDIATE');
    try {
      const c=active();
      if(db.prepare('SELECT 1 FROM party_start_requests WHERE id=?').get(requestId))fail(409,'This start request has already been used. Refresh before starting another party.');
      if((c?.id??null)!==(req.body.expectedCurrentId??null))fail(409,'The current party changed. Refresh and start again.');
      if(c&&isOpen(c))fail(409,'Close the current party before starting another.');
      db.prepare('UPDATE contests SET archived=1 WHERE archived=0').run();
      db.prepare('INSERT INTO contests VALUES (?,?,?,0,?)').run(id,title,JSON.stringify(settings),new Date(now()).toISOString());
      if(c)db.prepare('INSERT INTO party_transitions VALUES (?,?,0)').run(id,c.id);
      db.prepare('INSERT INTO party_start_requests VALUES (?,?)').run(requestId,id);
      db.exec('COMMIT');
    } catch(e) { db.exec('ROLLBACK'); throw e; }
    res.status(201).json({ id });
  });
  app.post('/api/host/contests/:id/undo-start',hostOnly,(req,res)=>{
    db.exec('BEGIN IMMEDIATE');
    try{
      const c=active(),info=undoInfo(c);
      if(c?.id!==req.params.id||!info||info.previousId!==req.body.previousId)fail(409,'The current party changed or this start has already been undone. Refresh and try again.');
      if(!info.enabled)fail(409,info.reason);
      const previous=getContest(info.previousId);
      db.prepare('UPDATE contests SET archived=1 WHERE id=?').run(c.id);
      db.prepare('UPDATE contests SET archived=0,settings=? WHERE id=?').run(JSON.stringify({...previous.settings,override:'closed'}),previous.id);
      db.prepare('UPDATE party_transitions SET undone=1 WHERE next_id=?').run(c.id);
      db.exec('COMMIT');res.json({ok:true,id:previous.id});
    }catch(e){db.exec('ROLLBACK');throw e;}
  });
  app.put('/api/host/contests/:id', hostOnly, (req, res) => {
    const c = getContest(req.params.id); if (!c || c.archived) fail(404, 'Current contest not found.');
    const settings = validateSettings(req.body.settings), title = text(req.body.title, 100, true);
    const used = entryRows(c.id).map(e => e.category);
    if (used.some(cat => !settings.categories.includes(cat))) fail(409, 'Keep categories that already contain entries.');
    db.prepare('UPDATE contests SET title=?, settings=? WHERE id=?').run(title, JSON.stringify(settings), c.id); res.json({ ok: true });
  });
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 1, fields: 5, fieldSize: 2000 } });
  let uploadsInFlight = 0;
  const reserveImageSlot=(req,res,next)=>{
    if(uploadsInFlight>=2)return res.status(429).json({error:'Two photos are processing. Please try again in a few seconds.'});
    uploadsInFlight++;res.once('close',()=>{uploadsInFlight--;});next();
  };
  async function preparePhoto(file){
    if(!file)fail(400,'Choose a photo (JPEG, PNG, or WebP, at most 8 MB).');
    try{
      const source=sharp(file.buffer,{limitInputPixels:40000000,animated:false}),metadata=await source.metadata();
      if(!['jpeg','png','webp'].includes(metadata.format)||(metadata.pages||1)!==1)fail(400,'Use a still JPEG, PNG, or WebP photo.');
      const image=await source.rotate().resize({width:1600,height:1600,fit:'inside',withoutEnlargement:true}).jpeg({quality:82}).toBuffer();
      return image;
    }catch(e){if(e.status)throw e;fail(400,'Could not read that photo. Use a JPEG, PNG, or WebP under 40 megapixels.');}
  }
  function savePhoto(image,file){
    const folder=path.join(dataDir,'photos'),size=readdirSync(folder).reduce((sum,name)=>sum+statSync(path.join(folder,name)).size,0);
    if(size+image.length>650*1024*1024)fail(507,'Photo storage is nearly full. Export the archive and increase storage.');
    writeFileSync(path.join(folder,file),image,{flag:'wx'});
  }
  app.get('/api/host/hall-of-fame',hostOnly,(req,res)=>{
    res.json(db.prepare(`SELECT e.*, c.title,c.settings,w.published FROM entries e JOIN contests c ON c.id=e.contest_id LEFT JOIN winners w ON w.entry_id=e.id WHERE w.entry_id IS NOT NULL OR json_extract(c.settings,'$.historical')=1 ORDER BY c.created DESC`).all().map(e=>({...entryView(e,true),contestTitle:e.title,historical:!!JSON.parse(e.settings).historical,published:!!e.published})));
  });
  app.post('/api/host/hall-of-fame',hostOnly,reserveImageSlot,upload.single('photo'),async(req,res)=>{
    const name=text(req.body.name,100,true),category=text(req.body.category,60,true),title=text(req.body.title,100,true);
    const image=await preparePhoto(req.file),id=randomUUID(),contestId=randomUUID(),file=`${id}.jpg`;
    const settings={historical:true,timezone:'America/Chicago',categories:[category],submissionMode:'host_only',override:'closed',start:null,entriesClose:null,end:null};
    savePhoto(image,file);
    db.exec('BEGIN IMMEDIATE');
    try{
      db.prepare('INSERT INTO contests VALUES (?,?,?,1,?)').run(contestId,title,JSON.stringify(settings),new Date(now()).toISOString());
      db.prepare('INSERT INTO entries VALUES (?,?,?,?,?,?,?,0,?)').run(id,contestId,name,category,'',file,req.visitor.id,new Date(now()).toISOString());
      db.exec('COMMIT');
    }catch(e){db.exec('ROLLBACK');throw e;}
    res.status(201).json({id,contestId});
  });
  app.put('/api/host/hall-of-fame/:id',hostOnly,reserveImageSlot,upload.single('photo'),async(req,res)=>{
    let e=db.prepare('SELECT * FROM entries WHERE id=?').get(req.params.id),c=e&&getContest(e.contest_id);
    if(!e||!c?.settings.historical)fail(404,'Historical winner not found. Edit voted contest entries through Archives.');
    const name=text(req.body.name,100,true),category=text(req.body.category,60,true),title=text(req.body.title,100,true);
    const image=req.file?await preparePhoto(req.file):null,file=image?`${randomUUID()}.jpg`:null;
    if(image)savePhoto(image,file);
    db.exec('BEGIN IMMEDIATE');
    try{
      e=db.prepare('SELECT * FROM entries WHERE id=?').get(req.params.id);c=getContest(e.contest_id);
      const published=db.prepare('SELECT published FROM winners WHERE entry_id=?').get(e.id);
      db.prepare('UPDATE entries SET name=?,category=?,photo=? WHERE id=?').run(name,category,file||e.photo,e.id);
      db.prepare('UPDATE contests SET title=?,settings=? WHERE id=?').run(title,JSON.stringify({...c.settings,categories:[category]}),c.id);
      if(published){db.prepare('DELETE FROM winners WHERE entry_id=?').run(e.id);db.prepare('INSERT INTO winners VALUES (?,?,?,?)').run(c.id,category,e.id,published.published);}
      db.exec('COMMIT');res.json({ok:true});
    }catch(err){db.exec('ROLLBACK');throw err;}
  });
  app.post('/api/entries', limiter(10), (req, res, next) => {
    if (uploadsInFlight >= 2) return res.status(429).json({ error: 'Two photos are processing. Please try again in a few seconds.' });
    uploadsInFlight++;
    res.once('close', () => { uploadsInFlight--; });
    const c = active(); if (!c || (!req.hostAuth && (phase(c, now()) !== 'live' || c.settings.submissionMode === 'host_only'))) return res.status(403).json({ error: 'Photo submissions are closed.' });
    next();
  }, upload.single('photo'), async (req, res) => {
    const c = active();
    if (!c || (!req.hostAuth && (phase(c, now()) !== 'live' || c.settings.submissionMode === 'host_only'))) fail(403, 'Photo submissions are closed.');
    const name = text(req.body.name, 100, true), category = text(req.body.category, 60, true), caption = text(req.body.caption || '', 300);
    if (!c.settings.categories.includes(category)) fail(400, 'Choose a contest category.');
    if (entryRows(c.id).length >= 500) fail(409, 'This contest has reached its 500-entry limit.');
    const image=await preparePhoto(req.file);
    // Image conversion is asynchronous: recheck the event after conversion before accepting it.
    const latest = active();
    if (!latest || latest.id !== c.id || (!req.hostAuth && (phase(latest, now()) !== 'live' || latest.settings.submissionMode === 'host_only'))) fail(403, 'The submission window has closed.');
    const id = randomUUID(), file = `${id}.jpg`;
    savePhoto(image,file);
    db.prepare('INSERT INTO entries VALUES (?,?,?,?,?,?,?,0,?)').run(id, c.id, name, category, caption, file, req.visitor.id, new Date(now()).toISOString());
    res.status(201).json({ id });
  });
  app.put('/api/entries/:id', (req, res) => {
    const e = db.prepare('SELECT * FROM entries WHERE id=?').get(req.params.id), c = e && getContest(e.contest_id);
    if (!e || (!req.hostAuth && (e.owner !== req.visitor.id || phase(c, now()) !== 'live'))) fail(403, 'This entry cannot be edited now.');
    const name = text(req.body.name, 100, true), caption = text(req.body.caption || '', 300);
    const category=req.body.category===undefined?e.category:text(req.body.category,60,true);
    if(category!==e.category){
      if(!req.hostAuth)fail(403,'Only the host can change an entry category.');
      if(!c.settings.categories.includes(category))fail(400,'Choose a contest category.');
      if(db.prepare('SELECT 1 FROM votes WHERE entry_id=?').get(e.id)||db.prepare('SELECT 1 FROM winners WHERE entry_id=?').get(e.id))fail(409,'Category is locked because this entry has votes or is a published winner.');
    }
    db.prepare('UPDATE entries SET name=?,caption=?,category=? WHERE id=?').run(name,caption,category,e.id); res.json({ ok: true });
  });
  app.post('/api/votes', limiter(30), (req, res) => {
    const c = active(); if (!isOpen(c)) fail(403, 'Voting is closed.');
    const e = db.prepare('SELECT * FROM entries WHERE id=? AND contest_id=? AND hidden=0').get(text(req.body.entryId, 80, true), c.id);
    if (!e) fail(404, 'That entry is unavailable.');
    try { db.prepare('INSERT INTO votes VALUES (?,?,?,?)').run(c.id, e.category, req.visitor.id, e.id); }
    catch (err) { if (db.prepare('SELECT 1 FROM votes WHERE contest_id=? AND category=? AND voter=?').get(c.id, e.category, req.visitor.id)) fail(409, 'You already voted in this category.'); throw err; }
    res.status(201).json({ ok: true });
  });
  app.post('/api/messages', limiter(5), (req, res) => {
    const c = active(); if (!isOpen(c)) fail(403, 'The message board is closed.');
    const author = text(req.body.author, 60, true), message = text(req.body.message, 300, true);
    if (db.prepare('SELECT COUNT(*) AS n FROM messages WHERE contest_id=?').get(c.id).n >= 1000) fail(409, 'The message board is full.');
    db.prepare('INSERT INTO messages VALUES (?,?,?,?,0,?)').run(randomUUID(), c.id, author, message, new Date(now()).toISOString()); res.status(201).json({ ok: true });
  });
  app.get('/api/photos/:id', (req, res) => {
    const e = db.prepare('SELECT * FROM entries WHERE id=?').get(req.params.id);
    const winner = e && db.prepare('SELECT 1 FROM winners WHERE entry_id=?').get(e.id);
    if (!e || (!req.hostAuth && !winner && (e.hidden || !isOpen(getContest(e.contest_id))))) fail(404, 'Photo is not publicly available.');
    res.type('jpg'); res.sendFile(path.join(dataDir, 'photos', e.photo), { cacheControl: false, lastModified: false, etag: false });
  });
  app.get('/api/host/contests/:id/archive', hostOnly, (req, res) => {
    const c = getContest(req.params.id); if (!c) fail(404, 'Contest not found.');
    res.json({ contest: c, entries: entryRows(c.id).map(e => entryView(e, true)), messages: db.prepare('SELECT id,author,message,hidden FROM messages WHERE contest_id=? ORDER BY created DESC').all(c.id), winners: db.prepare('SELECT category,entry_id AS entryId FROM winners WHERE contest_id=?').all(c.id) });
  });
  app.post('/api/host/moderate', hostOnly, (req, res) => {
    if (!['entries', 'messages'].includes(req.body.type) || typeof req.body.hidden !== 'boolean') fail(400, 'Invalid moderation request.');
    const id = text(req.body.id, 80, true);
    if (req.body.type === 'entries' && db.prepare('SELECT 1 FROM winners WHERE entry_id=?').get(id)) fail(409, 'Unpublish this winner before hiding its entry.');
    db.prepare(`UPDATE ${req.body.type} SET hidden=? WHERE id=?`).run(req.body.hidden ? 1 : 0, id); res.json({ ok: true });
  });
  app.put('/api/host/winners', hostOnly, (req, res) => {
    const c = getContest(text(req.body.contestId, 80, true)); if (!c) fail(404, 'Contest not found.');
    if (phase(c, now()) !== 'closed') fail(409, 'Close voting before publishing winners.');
    const cat = text(req.body.category, 60, true);
    if (req.body.entryId === null) { db.prepare('DELETE FROM winners WHERE contest_id=? AND category=?').run(c.id, cat); return res.json({ ok: true }); }
    const entries = entryRows(c.id).filter(e => !e.hidden && e.category === cat), max = Math.max(0, ...entries.map(e => e.votes));
    const winner = entries.find(e => e.id === req.body.entryId);
    if (!winner || (!c.settings.historical&&(max === 0 || winner.votes !== max))) fail(400, 'Choose a leading entry with at least one vote. The host decides tied results.');
    db.prepare('INSERT INTO winners VALUES (?,?,?,?) ON CONFLICT(contest_id,category) DO UPDATE SET entry_id=excluded.entry_id,published=excluded.published').run(c.id, cat, winner.id, new Date(now()).toISOString()); res.json({ ok: true });
  });
  app.get('/api/host/export', hostOnly, (req, res) => {
    const tables = Object.fromEntries(['contests', 'entries', 'votes', 'messages', 'winners'].map(t => [t, db.prepare(`SELECT * FROM ${t}`).all()]));
    res.attachment(`party-archive-${new Date(now()).toISOString().slice(0,10)}.zip`);
    const zip = archiver('zip', { zlib: { level: 6 } });
    zip.on('error', err => res.destroy(err)); res.on('close', () => zip.abort()); zip.pipe(res);
    zip.append(JSON.stringify({ version: 1, exportedAt: new Date(now()).toISOString(), tables }, null, 2), { name: 'archive.json' });
    for (const e of tables.entries) zip.file(path.join(dataDir, 'photos', e.photo), { name: `photos/${e.photo}` });
    zip.finalize();
  });
  app.get('/api/qr', async (req, res) => { res.type('png').send(await QRCode.toBuffer(`${origin || `${req.protocol}://${req.get('host')}`}/party/`, { width: 600, margin: 2 })); });
  app.use(express.static(path.join(root, 'public'), { etag: false, lastModified: false, cacheControl: false }));
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    const status = err.status || (err instanceof multer.MulterError ? 400 : 500);
    if (status === 500) console.error('Request failed:', err.message);
    res.status(status).json({ error: status === 500 ? 'The server could not save that change. Please try again.' : err instanceof multer.MulterError ? 'Upload one photo, no larger than 8 MB.' : err.message });
  });
  return app;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = createApp();
  let backingUp = false;
  const runBackup = async () => {
    if (backingUp) return;
    backingUp = true;
    try { await databaseBackup(app.locals.db, app.locals.dataDir); }
    catch(e) { console.error('Daily database backup failed:', e.message); }
    finally { backingUp = false; }
  };
  runBackup();
  const timer = setInterval(runBackup, 3600000); timer.unref();
  const server = app.listen(Number(process.env.PORT || 3000), '0.0.0.0', () => console.log(`Website listening on port ${server.address().port}`));
  process.on('SIGTERM', () => { clearInterval(timer); server.close(() => { app.locals.db.close(); process.exit(0); }); });
}
