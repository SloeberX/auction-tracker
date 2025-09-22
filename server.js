import express from 'express';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { createScraper } from './scraper/index.js';
import { registerDiscordRoutes, handleDiscordTick, loadSettings } from './server/discord.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new SocketIOServer(httpServer, { cors: { origin: '*' } });
app.use(express.json({ limit: '256kb' }));

const PORT = process.env.PORT || 3000;
app.use(express.static(path.join(__dirname, 'public')));
registerDiscordRoutes(app);

// ----- persistence -----
const listingsPath = path.join(__dirname, 'data', 'listings.json');
const historyPath  = path.join(__dirname, 'data', 'history.json');
function ensureFile(fp, fallbackObj){ if (!fs.existsSync(fp)){ fs.mkdirSync(path.dirname(fp), { recursive: true }); fs.writeFileSync(fp, JSON.stringify(fallbackObj, null, 2)); } }
function atomicWrite(fp, obj){ const tmp=fp+'.tmp'; fs.writeFileSync(tmp, JSON.stringify(obj, null, 2)); fs.renameSync(tmp, fp); }
function loadJSON(fp, fallbackObj){ ensureFile(fp, fallbackObj); try{ return JSON.parse(fs.readFileSync(fp,'utf8')); }catch{ return fallbackObj; } }

let listings = loadJSON(listingsPath, { listings: [] }).listings;
let history  = loadJSON(historyPath,  { bidsById: {} }).bidsById;

function saveListings(){ atomicWrite(listingsPath, { listings }); }
function saveHistory(){ atomicWrite(historyPath, { bidsById: history }); }

// ----- state -----
const state = new Map();
const alertState = new Map();
function broadcast(id){ const p=state.get(id); if(p) io.emit('listing:update', p); }
io.on('connection', sock => { for (const [id,data] of state.entries()) sock.emit('listing:update', data); });

// ----- API -----
app.post('/api/listings', (req,res)=>{
  const { url, name } = req.body || {};
  if (!url) return res.status(400).json({ ok:false, error:'Missing URL' });
  const next = 1 + listings.reduce((m,l)=>Math.max(m, Number((l.id||'').split('lot-')[1])||0), 0);
  const id = 'lot-' + next;
  const newLot = { id, url, name: name || null };
  listings.push(newLot); saveListings();
  if (!history[id]) history[id] = []; saveHistory();
  startLoop(newLot);
  res.json({ ok:true, id });
});
app.delete('/api/listings/:id', (req,res)=>{
  const { id } = req.params;
  listings = listings.filter(l => l.id !== id); saveListings();
  state.delete(id); alertState.delete(id); delete history[id]; saveHistory();
  io.emit('listing:remove', { id });
  res.json({ ok:true });
});
app.post('/api/listings/:id/name', (req,res)=>{
  const { id } = req.params; const { name } = req.body || {};
  if (!name || typeof name !== 'string') return res.status(400).json({ ok:false, error:'Missing name' });
  let found=false; listings = listings.map(l => { if(l.id===id){ found=true; return { ...l, name }; } return l; });
  if (!found) return res.status(404).json({ ok:false, error:'Listing not found' });
  saveListings();
  const cur = state.get(id); if (cur){ cur.meta = { ...cur.meta, displayName: name }; state.set(id, cur); broadcast(id); }
  res.json({ ok:true });
});

// Legacy simple settings endpoints (kept for compatibility with older UI)
app.get('/api/settings', (_req,res)=>{
  res.json({ discordWebhookUrl: process.env.DISCORD_WEBHOOK_URL || '', alertOnNewBid:true, alertOn30min:true, alertCooldownMinutes:10 });
});
app.post('/api/settings', (_req,res)=>{ res.json({ ok:true }); });

// Export history
app.get('/api/listings/:id/history.json', (req,res)=>{
  const { id } = req.params;
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.end(JSON.stringify({ id, bids: history[id] || [] }, null, 2));
});
app.get('/api/listings/:id/history.csv', (req,res)=>{
  const { id } = req.params;
  const rows = (history[id]||[]).slice().sort((a,b)=> new Date((b.timeISO||b.dateISO)) - new Date((a.timeISO||a.dateISO)));
  const esc = (s)=>(''+(s??'')).replace(/"/g,'""');
  let out = 'amount,amountText,timeISO,dateISO,source\n';
  for (const r of rows){ out += `"${esc(r.amount)}","${esc(r.amountText)}","${esc(r.timeISO||'')}","${esc(r.dateISO||'')}","${esc(r.source||'')}"\n`; }
  res.setHeader('Content-Type','text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${id}-history.csv"`);
  res.end(out);
});

// ----- scheduling -----
const refreshSecondsDefault = Number(process.env.REFRESH_SECONDS || 37);
function computeNextIntervalMs(endsAtISO){
  try{
    if(!endsAtISO) return refreshSecondsDefault*1000;
    const remain = new Date(endsAtISO).getTime() - Date.now();
    return (remain <= 30*60*1000) ? 7000 : (refreshSecondsDefault*1000);
  }catch{ return refreshSecondsDefault*1000; }
}

async function sendDiscord({ content }){
  const WEBHOOK = (process.env.DISCORD_WEBHOOK_URL||'').trim();
  if(!WEBHOOK) return;
  try {
    await fetch(WEBHOOK, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ content }) });
  } catch {}
}
function iso(){ return new Date().toISOString(); }
function eqAmount(a,b){ if(a==null||b==null) return false; return Math.abs(Number(a)-Number(b))<1e-6; }
function timeMs(x){ return x ? new Date(x).getTime() : NaN; }
function betterSourceRank(src){ const s=String(src||''); if(s==='observed') return 3; if(s==='scraped-time') return 2; if(s==='scraped-date') return 1; return 0; }

function mergeBidsPersist(id, scrapedBids){
  const list = history[id] || (history[id]=[]);
  let changed=false;
  for (const s of (scrapedBids||[])){
    const src = s.timeISO ? 'scraped-time' : 'scraped-date';
    let bestIdx=-1; let bestRank=-1;
    for (let i=0;i<list.length;i++){
      const x=list[i];
      if (!eqAmount(x.amount, s.amount)) continue;
      const tS = timeMs(s.timeISO||s.dateISO);
      const tX = timeMs(x.timeISO||x.dateISO);
      const close = isFinite(tS)&&isFinite(tX) ? Math.abs(tS - tX) <= 10*60*1000 : false;
      const near  = isFinite(tS)&&isFinite(tX) ? Math.abs(tS - tX) <= 14*24*60*60*1000 : false;
      const sameDay = (s.dateISO && x.dateISO) && (new Date(s.dateISO).toDateString() === new Date(x.dateISO).toDateString());
      if (close || near || sameDay || (!x.timeISO && s.timeISO)){
        const rank = betterSourceRank(x.source);
        if (rank > bestRank){ bestRank = rank; bestIdx = i; }
      }
    }
    if (bestIdx>=0){
      const x = list[bestIdx];
      const newRank = betterSourceRank(src);
      const curRank = betterSourceRank(x.source);
      if (newRank > curRank){
        x.timeISO = s.timeISO || x.timeISO || null;
        x.dateISO = s.dateISO || (x.timeISO ? null : x.dateISO) || null;
        x.source = src;
        changed=true;
      }
      if (!x.amountText && s.amountText){ x.amountText = s.amountText; changed=true; }
    } else {
      list.push({ ...s, source: src });
      changed=true;
    }
  }
  list.sort((a,b)=> new Date((a.timeISO||a.dateISO)) - new Date((b.timeISO||b.dateISO)));
  const collapsed=[];
  for (const x of list){
    let kept=true;
    for (let i=collapsed.length-1;i>=0;i--){
      const y=collapsed[i];
      if (!eqAmount(x.amount, y.amount)) continue;
      const tx=timeMs(x.timeISO||x.dateISO), ty=timeMs(y.timeISO||y.dateISO);
      if (isFinite(tx)&&isFinite(ty) && Math.abs(tx-ty)<=10*60*1000){
        const xr=betterSourceRank(x.source), yr=betterSourceRank(y.source);
        if (xr>yr){ collapsed[i] = { ...y, ...x }; }
        kept=false; break;
      }
      if (!x.timeISO && !y.timeISO && x.dateISO && y.dateISO &&
          new Date(x.dateISO).toDateString() === new Date(y.dateISO).toDateString()){
        kept=false; break;
      }
    }
    if (kept) collapsed.push(x);
  }
  history[id]=collapsed;
  if (changed) saveHistory();
  return collapsed.slice();
}

const stateDefaults = (item)=> ({
  id:item.id, url:item.url,
  meta:{ title:'Loading…', ...(item.name?{displayName:item.name}:{}) },
  bids:[], endsAt:null, lastUpdated:null, currentInterval: refreshSecondsDefault*1000,
  currentPrice:null, lastChangeAt:null, image:null
});

async function startLoop(item){
  const id = item.id;
  if (!history[id]) history[id] = [];
  state.set(id, stateDefaults(item));
  alertState.set(id, { lastBidAmount:null, lastBidAlertAtISO:null, lastAlert30mAtISO:null });

  const scraper = global.scraper;
  (async function loop(){
    let nextDelay = refreshSecondsDefault*1000;
    try{
      const r = await scraper.fetch(item.url);
      const prev = state.get(id) || {};
      const displayName = prev?.meta?.displayName || item.name || null;
      nextDelay = computeNextIntervalMs(r.endsAt);

      mergeBidsPersist(id, r.bids || []);

      const prevAmount = prev.currentPrice ?? null;
      const newAmount = Number.isFinite(r.currentPrice) ? r.currentPrice : prevAmount;
      let lastChangeAt = prev.lastChangeAt || null;
      if (Number.isFinite(newAmount) && newAmount !== prevAmount){
        lastChangeAt = iso();
        const hasSame = (history[id]||[]).some(b => Number.isFinite(b.amount) && Math.abs(Number(b.amount)-newAmount)<1e-6 && !!b.timeISO);
        if (!hasSame){
          history[id].push({ amount:newAmount, amountText:`€ ${newAmount.toFixed(2).replace('.',',')}`, timeISO: iso(), source:'observed' });
          saveHistory();
        }
      }

      const outBids = (history[id]||[]).slice().sort((a,b)=> new Date((b.timeISO||b.dateISO)) - new Date((a.timeISO||a.dateISO))).slice(0,40);
      const payload = {
        id, url:item.url,
        meta:{ title:r.meta?.title||r.title||'Auction lot', currency:r.meta?.currency||r.currency||'EUR', ...(displayName?{displayName}:{}) },
        bids: outBids, endsAt:r.endsAt,
        currentPrice: Number.isFinite(newAmount)?newAmount:null,
        lastChangeAt, lastUpdated: iso(),
        currentInterval: nextDelay,
        image: r.image || prev.image || null
      };
      state.set(id, payload);
      broadcast(id);

      // Discord rich embeds
      const ds = loadSettings();
      handleDiscordTick({
        title: payload.meta.title, alias: displayName || null,
        url: payload.url, image: payload.image,
        currentPrice: payload.currentPrice, endsAt: payload.endsAt, lastChangeAt: payload.lastChangeAt
      }, ds).catch(()=>{});

      // Legacy simple text webhook (optional)
      const a = alertState.get(id) || {};
      const WEBHOOK = (process.env.DISCORD_WEBHOOK_URL||'').trim();
      if (WEBHOOK){
        if (Number.isFinite(newAmount) && newAmount !== a.lastBidAmount){
          const now = Date.now();
          const lastAt = a.lastBidAlertAtISO ? new Date(a.lastBidAlertAtISO).getTime() : 0;
          const CD = 10*60*1000;
          if (now - lastAt > CD){
            await sendDiscord({ content:`📈 **New bid** on ${displayName || (r.meta?.title||'Lot')} — now €${newAmount.toFixed(2).replace('.', ',')}\n${item.url}` });
            a.lastBidAlertAtISO = iso();
          }
          a.lastBidAmount = newAmount;
        }
        if (r.endsAt){
          const remain = new Date(r.endsAt).getTime() - Date.now();
          if (remain > 0 && remain <= 30*60*1000){
            const now = Date.now();
            const last = a.lastAlert30mAtISO ? new Date(a.lastAlert30mAtISO).getTime() : 0;
            const CD = 10*60*1000;
            if (now - last > CD){
              await sendDiscord({ content:`⏳ **< 30 minutes** left on ${displayName || (r.meta?.title||'Lot')}\nEnds at: ${new Date(r.endsAt).toLocaleString('nl-NL')}\n${item.url}` });
              a.lastAlert30mAtISO = iso();
            }
          }
        }
      }
      alertState.set(id, a);
    }catch(e){
      const prev = state.get(id) || {};
      state.set(id, { ...prev, id, url:item.url, meta:{ ...(prev.meta||{}), error: e.message }, lastUpdated: iso(), currentInterval: refreshSecondsDefault*1000 });
      broadcast(id);
    }finally{
      setTimeout(loop, nextDelay);
    }
  })();
}

async function main(){
  const scraper = await createScraper({ headless: (process.env.HEADLESS||'true').toLowerCase()==='true' });
  global.scraper = scraper;
  for (const item of listings) startLoop(item);
  httpServer.listen(PORT, ()=> console.log(`Auction tracker on http://localhost:${PORT}`));
}
main();
