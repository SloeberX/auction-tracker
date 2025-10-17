import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createScraper } from './scraper/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const LOG_LEVEL = (process.env.LOG_LEVEL || 'info').toLowerCase();

// ---- Failsafe Data Toolkit (single imports at top; NO additional imports mid-file) ----
const DATA_DIR = path.join(__dirname, 'data');
const BAK_DIR  = path.join(DATA_DIR, 'backups');

function log(level, ...args){ 
  if (level === 'error') return console.error('[error]', ...args);
  if (LOG_LEVEL === 'debug' || LOG_LEVEL === 'info') {
    if (level === 'debug' && LOG_LEVEL !== 'debug') return;
    console.log(`[${level}]`, ...args);
  }
}
function ensureDirs(){
  try{ fs.mkdirSync(DATA_DIR, { recursive:true }); }catch{}
  try{ fs.mkdirSync(BAK_DIR, { recursive:true }); }catch{}
}
function atomicWrite(filePath, content){
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, filePath);
}
function readJsonSafe(filePath, fallback){
  try{ return JSON.parse(fs.readFileSync(filePath,'utf8')); }catch{ return fallback; }
}
function listBackupsSorted(){
  try{
    const entries = fs.readdirSync(BAK_DIR).map(name => ({
      name, full: path.join(BAK_DIR, name),
      mtime: fs.statSync(path.join(BAK_DIR, name)).mtimeMs
    })).filter(e => fs.existsSync(path.join(e.full,'listings.json')) && fs.existsSync(path.join(e.full,'history.json')));
    return entries.sort((a,b)=>b.mtime-a.mtime);
  }catch{ return []; }
}
function createBackupNow(label='startup'){
  try{
    ensureDirs();
    const stamp = new Date().toISOString().replace(/[:.]/g,'-').slice(0,19);
    const dir = path.join(BAK_DIR, stamp + '_' + label);
    fs.mkdirSync(dir, { recursive:true });
    for (const f of ['listings.json','history.json','settings.json']){
      const src = path.join(DATA_DIR, f);
      const dst = path.join(dir, f);
      if (fs.existsSync(src)) fs.copyFileSync(src, dst);
      else fs.writeFileSync(dst, f==='history.json' ? '{}' : '[]');
    }
    log('info','[backup] snapshot', dir);
  }catch(e){ log('error','[backup] failed', e?.message||e); }
}
function pruneBackups(){
  try{
    const THIRTY_DAYS = 30*24*3600*1000;
    const now = Date.now();
    for (const name of fs.readdirSync(BAK_DIR)){
      const full = path.join(BAK_DIR, name);
      const m = fs.statSync(full).mtimeMs;
      if (now - m > THIRTY_DAYS){
        fs.rmSync(full, { recursive:true, force:true });
        log('info','[backup] pruned', name);
      }
    }
  }catch{}
}
function autoRestoreIfCorrupt(){
  ensureDirs();
  let listings=null, history=null;
  try{ listings = JSON.parse(fs.readFileSync(path.join(DATA_DIR,'listings.json'),'utf8')); }catch{}
  try{ history  = JSON.parse(fs.readFileSync(path.join(DATA_DIR,'history.json'),'utf8')); }catch{}
  let need = false;
  if (!Array.isArray(listings)) need = true;
  if (history && typeof history !== 'object') need = true;
  if (!fs.existsSync(path.join(DATA_DIR,'listings.json'))) need = true;
  if (!fs.existsSync(path.join(DATA_DIR,'history.json'))) need = true;
  if (!need) return false;
  const backups = listBackupsSorted();
  if (backups.length){
    const src = backups[0].full;
    for (const f of ['listings.json','history.json','settings.json']){
      const s = path.join(src,f), d = path.join(DATA_DIR,f);
      try{ fs.copyFileSync(s,d); }catch{ fs.writeFileSync(d, f==='history.json'?'{}':'[]');}
    }
    log('info','[restore] Auto-restore from', backups[0].name);
    return true;
  } else {
    try{ fs.writeFileSync(path.join(DATA_DIR,'listings.json'),'[]'); }catch{}
    try{ fs.writeFileSync(path.join(DATA_DIR,'history.json'),'{}'); }catch{}
    log('info','[restore] Created fresh data files');
    return true;
  }
}
function dedupeHistoryFile(){
  try{
    const p = path.join(DATA_DIR,'history.json');
    const h = readJsonSafe(p, {});
    const out = {};
    for (const [id, arr] of Object.entries(h||{})){
      const seen = new Set();
      const cleaned = [];
      for (const b of (arr||[])){
        const amt = Number(b.amount);
        if (!Number.isFinite(amt)) continue;
        const key = `${amt}|${b.timeISO||b.dateISO||''}`;
        if (seen.has(key)) continue;
        seen.add(key);
        cleaned.push({ ...b, amount: amt });
      }
      out[id] = cleaned;
    }
    atomicWrite(p, JSON.stringify(out,null,2));
    log('info','[dedupe] history cleaned');
  }catch(e){ log('error','[dedupe] failed', e?.message||e); }
}
function initFailsafe(){
  ensureDirs();
  const restored = (process.env.AUTO_RESTORE||'true')==='true' ? autoRestoreIfCorrupt() : false;
  pruneBackups();
  createBackupNow(restored?'after-restore':'startup');
  dedupeHistoryFile();
  const hours = Number(process.env.BACKUP_INTERVAL_HOURS||6);
  setInterval(()=>{ createBackupNow('periodic'); pruneBackups(); }, Math.max(1,hours)*3600*1000);
  for (const sig of ['SIGINT','SIGTERM']){
    try{ process.on(sig, ()=>{ try{ createBackupNow('shutdown'); }catch{} setTimeout(()=>process.exit(0),100); }); }catch{}
  }
}

// ---- Load data ----
initFailsafe();
let listings = readJsonSafe(path.join(DATA_DIR,'listings.json'), []);
let history  = readJsonSafe(path.join(DATA_DIR,'history.json'), {});
let settings = readJsonSafe(path.join(DATA_DIR,'settings.json'), {});

// ---- Express / Socket.io ----
const app = express();
const server = http.createServer(app);
import { Server as IOServer } from 'socket.io';
const io = new IOServer(server, { cors: { origin: '*' } });

// no-cache for assets
app.use((req,res,next)=>{
  res.set('Cache-Control','no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma','no-cache');
  res.set('Expires','0');
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

// basic API
app.get('/api/listings', (req,res)=>{
  res.json({ listings, history, settings });
});

// start server
server.listen(PORT, ()=>{
  console.log(`[server] up on http://localhost:${PORT}`);
});

// ---- Minimal scheduler scaffold to keep process alive ----
(async function mainLoop(){
  try{
    const scraper = await createScraper({ headless: (process.env.HEADLESS||'true')==='true' });
    // no-op loop; just ping to keep Node busy
    setInterval(()=>{}, 1e9);
  }catch(e){
    log('error','scraper init failed', e?.message||e);
    setInterval(()=>{}, 1e9);
  }
})();
