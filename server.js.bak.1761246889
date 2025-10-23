import 'dotenv/config';
import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { Server as IOServer } from 'socket.io';
import { createBrowser, pickScraper } from './scraper/index.js';
import { scrapeAuctivo } from './scraper/auctivo.js';
import { sendDiscord, lotEmbed } from './server/discord.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT||3000);
const LOG_LEVEL = (process.env.LOG_LEVEL||'info').toLowerCase();
const DATA_DIR = path.join(__dirname,'data');
const BAK_DIR = path.join(DATA_DIR,'backups');

function log(level, ...args){
  if (level==='error') return console.error('[error]',...args);
  if (LOG_LEVEL==='debug' || LOG_LEVEL==='info'){
    if (level==='debug' && LOG_LEVEL!=='debug') return;
    console.log(`[${level}]`, ...args);
  }
}

// data helpers
function ensureDirs(){ fs.mkdirSync(DATA_DIR,{recursive:true}); fs.mkdirSync(BAK_DIR,{recursive:true}); }
function atomicWrite(file, s){ const tmp=file+'.tmp'; fs.writeFileSync(tmp,s); fs.renameSync(tmp,file); }
function readJson(file, fallback){ try{ return JSON.parse(fs.readFileSync(path.join(DATA_DIR,file),'utf8')); }catch{ return fallback; } }
function saveJson(file, data){ atomicWrite(path.join(DATA_DIR,file), JSON.stringify(data,null,2)); }
function dedupeHistory(hist){
  const out = {}; for (const [id, arr] of Object.entries(hist||{})){ const seen=new Set(), clean=[]; for(const b of (arr||[])){ const amt=Number(b.amount); if(!Number.isFinite(amt)) continue; const key=`${amt}|${b.timeISO||''}`; if(seen.has(key)) continue; seen.add(key); clean.push({...b,amount:amt}); } out[id]=clean; } return out;
}
function createBackup(label='startup'){
  try{
    const stamp = new Date().toISOString().replace(/[:.]/g,'-').slice(0,19);
    const dir = path.join(BAK_DIR, stamp+'_'+label);
    fs.mkdirSync(dir,{recursive:true});
    for(const f of ['listings.json','history.json','settings.json']){ const src=path.join(DATA_DIR,f); fs.copyFileSync(src, path.join(dir,f)); }
  }catch{}
}
function pruneBackups(){ try{ const THIRTY=30*24*3600*1000; const now=Date.now(); for(const n of fs.readdirSync(BAK_DIR)){ const full=path.join(BAK_DIR,n); if(now-fs.statSync(full).mtimeMs>THIRTY) fs.rmSync(full,{recursive:true,force:true}); } }catch{} }

ensureDirs();
if (!fs.existsSync(path.join(DATA_DIR,'listings.json'))) saveJson('listings.json', []);
if (!fs.existsSync(path.join(DATA_DIR,'history.json'))) saveJson('history.json', {});
if (!fs.existsSync(path.join(DATA_DIR,'settings.json'))) saveJson('settings.json', {});

let listings = readJson('listings.json', []);
let history  = readJson('history.json', {});
let settings = readJson('settings.json', {});
history = dedupeHistory(history);
saveJson('history.json', history);
createBackup('startup');
setInterval(()=>{ createBackup('periodic'); pruneBackups(); }, Math.max(1, Number(process.env.BACKUP_INTERVAL_HOURS||6))*3600*1000);

function getWebhook(){
  const s = readJson('settings.json', {});
  return (s.discordWebhook || (process.env.DISCORD_WEBHOOK_URL||'')).trim();
}

// server
const app = express();
const server = http.createServer(app);
const io = new IOServer(server, { cors:{ origin:'*' } });
app.use(express.json({ limit:'512kb' }));
app.use((req,res,next)=>{ res.set('Cache-Control','no-store, no-cache, must-revalidate, proxy-revalidate'); res.set('Pragma','no-cache'); res.set('Expires','0'); next(); });
app.use(express.static(path.join(__dirname,'public')));
app.use('/public', express.static(path.join(__dirname,'public')));

// settings API
app.get('/api/settings', (req,res)=>{ const s=readJson('settings.json',{}); res.json({ discordWebhook: s.discordWebhook||'' }); });
app.post('/api/settings', (req,res)=>{ try{ const s=readJson('settings.json',{}); s.discordWebhook = (req.body?.discordWebhook||'').trim(); saveJson('settings.json', s); res.json({ok:true}); }catch(e){ res.status(500).json({ok:false,error:String(e?.message||e)}); } });

// data APIs
app.get('/api/listings', (req,res)=>{ res.json({ listings: readJson('listings.json',[]), history: readJson('history.json',{}), settings: readJson('settings.json',{}) }); });
app.post('/api/add', (req,res)=>{
  try{
    const { url, title } = req.body || {};
    if (!url || typeof url!=='string') return res.status(400).json({ok:false,error:'missing url'});
    listings = readJson('listings.json',[]);
    const id = 'id-'+Math.random().toString(36).slice(2,10);
    const entry = { id, url, title: title||url, image:'', currentPrice:null, endsAt:null, updatedAt:Date.now(), lastChange:null };
    listings.unshift(entry); saveJson('listings.json', listings);
    io.emit('change');
    // initial embed (if webhook exists)
    const hook = getWebhook(); if (hook) sendDiscord(hook, lotEmbed(entry)).catch(()=>{});
    res.json({ok:true,id});
  }catch(e){ res.status(500).json({ok:false,error:String(e?.message||e)}); }
});
app.post('/api/remove',(req,res)=>{ try{ const { id } = req.body||{}; listings=readJson('listings.json',[]).filter(x=>x.id!==id); saveJson('listings.json', listings); io.emit('change'); res.json({ok:true}); }catch{ res.status(500).json({ok:false}); } });
app.post('/api/rename',(req,res)=>{ try{ const { id, title } = req.body||{}; listings=readJson('listings.json',[]); const it=listings.find(x=>x.id===id); if(it){ it.title=title; saveJson('listings.json', listings); io.emit('change'); } res.json({ok:true}); }catch{ res.status(500).json({ok:false}); } });

// manual discord ping
app.post('/api/ping-discord', (req,res)=>{
  try{
    const { id } = req.body||{};
    const L = readJson('listings.json',[]);
    const it = L.find(x=>x.id===id);
    if(!it) return res.status(404).json({ok:false,error:'not found'});
    const hook = getWebhook(); if(!hook) return res.status(400).json({ok:false,error:'webhook not set'});
    sendDiscord(hook, lotEmbed(it)).then(ok=>res.json({ok})).catch(e=>res.status(500).json({ok:false,error:String(e?.message||e)}));
  }catch(e){ res.status(500).json({ok:false,error:String(e?.message||e)}); }
});

server.listen(PORT, ()=> log('info',`[server] http://localhost:${PORT}`));

// scraper
let ctx = null;
(async function initBrowser(){
  try{
    const { browser, context } = await createBrowser();
    ctx = context; process.on('exit', ()=> browser.close().catch(()=>{}));
  }catch(e){ log('error','browser init failed',e?.message||e); }
})();

async function scrapeOne(listing){
  const which = pickScraper(listing.url);
  if (!ctx || !which) return null;
  try{ if (which==='auctivo'){ return await scrapeAuctivo({context:ctx, url:listing.url}); } return null; }catch{ return null; }
}
function nextInterval(msRemaining){ if(msRemaining==null) return 37000; if(msRemaining<5*60*1000) return 5000; if(msRemaining<30*60*1000) return 10000; return 37000; }

async function updateLoop(){
  try{
    listings = readJson('listings.json',[]);
    history  = readJson('history.json',{});
    let changed=false;
    for(const it of listings){
      const data = await scrapeOne(it);
      if(!data) continue;
      let lc=null;
      if(typeof data.currentPrice==='number' && data.currentPrice!==it.currentPrice){
        lc = Date.now();
        if(!history[it.id]) history[it.id]=[];
        history[it.id].unshift({ timeISO:new Date(lc).toISOString(), amount:data.currentPrice });
        // dedupe per-id
        const seen=new Set(); const clean=[]; for(const b of history[it.id]){ const key=`${Number(b.amount)}|${b.timeISO||''}`; if(seen.has(key)) continue; seen.add(key); clean.push({...b,amount:Number(b.amount)}); } history[it.id]=clean;
      }
      if(data.endsAt && data.endsAt!==it.endsAt){ lc = lc || Date.now(); }
      it.title = data.title || it.title;
      it.image = data.image || it.image;
      if(typeof data.currentPrice==='number') it.currentPrice=data.currentPrice;
      if(data.endsAt) it.endsAt=data.endsAt;
      it.updatedAt=Date.now();
      if(lc){ it.lastChange=lc; changed=true; const hook=getWebhook(); if(hook) sendDiscord(hook, lotEmbed({title:it.title,url:it.url,image:it.image,price:it.currentPrice,endsAt:it.endsAt,lastChange:new Date(lc).toLocaleTimeString()})).catch(()=>{}); }
    }
    if(changed){ saveJson('history.json', history); saveJson('listings.json', listings); io.emit('change'); }
  }catch(e){ log('error','loop',e?.message||e); }
  const soonest = listings.map(l=>l.endsAt?new Date(l.endsAt).getTime()-Date.now():null).filter(v=>v!=null);
  const ms = soonest.length? Math.min(...soonest.map(v=>nextInterval(v))) : 37000;
  setTimeout(updateLoop, Math.max(5000, ms));
}
setTimeout(updateLoop, 5000);
