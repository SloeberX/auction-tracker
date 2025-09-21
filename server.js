import express from 'express';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { createScraper } from './scraper/index.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new SocketIOServer(httpServer, { cors: { origin: '*' } });
app.use(express.json({ limit: '256kb' }));

const PORT = process.env.PORT || 3000;
app.use(express.static(path.join(__dirname, 'public')));

// --------- persistence helpers ---------
const listingsPath = path.join(__dirname, 'data', 'listings.json');
const historyPath  = path.join(__dirname, 'data', 'history.json');

function ensureFile(fp, fallbackObj){
  if (!fs.existsSync(fp)) {
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, JSON.stringify(fallbackObj, null, 2));
  }
}
function atomicWrite(fp, obj){
  const tmp = fp + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, fp);
}
function loadJSON(fp, fallbackObj){
  ensureFile(fp, fallbackObj);
  try { return JSON.parse(fs.readFileSync(fp, 'utf8')); }
  catch { return fallbackObj; }
}

const settingsPath = path.join(__dirname, 'data', 'settings.json');
function loadSettings(){
  ensureFile(settingsPath, { discordWebhookUrl: "", alertOnNewBid: true, alertOn30min: true, alertCooldownMinutes: 10 });
  try { return JSON.parse(fs.readFileSync(settingsPath,'utf8')); } catch { return { discordWebhookUrl: "", alertOnNewBid: true, alertOn30min: true, alertCooldownMinutes: 10 }; }
}
function saveSettings(obj){
  const tmp = settingsPath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, settingsPath);
}
let settings = loadSettings();
let listings = loadJSON(listingsPath, { listings: [] }).listings;
let history  = loadJSON(historyPath,  { bidsById: {} }).bidsById; // { id: [ {amount, amountText, timeISO?, dateISO?, source?} ] }

function saveListings(){ atomicWrite(listingsPath, { listings }); }
function saveHistory(){ atomicWrite(historyPath, { bidsById: history }); }

// --------- runtime state ---------
const state = new Map();        // UI payload per id
const alertState = new Map();   // per id { lastBidAmount, lastAlert30mAtISO, lastBidAlertAtISO }

function broadcast(id){ const p=state.get(id); if(p) io.emit('listing:update', p); }
io.on('connection', sock => { for (const [id, data] of state.entries()) sock.emit('listing:update', data); });

// --------- API ---------
// ---- Settings API ----
app.get('/api/settings', (req,res)=>{
  res.json({
    discordWebhookUrl: WEBHOOK,
    alertOnNewBid: !!ALERT_NEW_BID,
    alertOn30min: !!ALERT_30M,
    alertCooldownMinutes: Math.round(ALERT_CD_MS/60000)
  });
});
app.post('/api/settings', (req,res)=>{
  const { discordWebhookUrl, alertOnNewBid, alertOn30min, alertCooldownMinutes } = req.body || {};
  settings.discordWebhookUrl = (discordWebhookUrl||'').trim();
  settings.alertOnNewBid = !!alertOnNewBid;
  settings.alertOn30min = !!alertOn30min;
  settings.alertCooldownMinutes = Math.max(1, Number(alertCooldownMinutes||10));
  saveSettings(settings);
  WEBHOOK = settings.discordWebhookUrl || '';
  ALERT_NEW_BID = !!settings.alertOnNewBid;
  ALERT_30M = !!settings.alertOn30min;
  ALERT_CD_MS = Math.max(1, settings.alertCooldownMinutes)*60*1000;
  res.json({ ok:true });
});

// ---- Export endpoints (history per lot) ----
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
  for (const r of rows){
    out += `"${esc(r.amount)}","${esc(r.amountText)}","${esc(r.timeISO||'')}","${esc(r.dateISO||'')}","${esc(r.source||'')}"\n`;
  }
  res.setHeader('Content-Type','text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${id}-history.csv"`);
  res.end(out);
});
app.post('/api/listings', (req, res) => {
  const { url, name } = req.body || {};
  if (!url) return res.status(400).json({ ok:false, error:'Missing URL' });
  const next = 1 + listings.reduce((m,l)=>Math.max(m, Number((l.id||'').split('lot-')[1])||0), 0);
  const id = 'lot-' + next;
  const newLot = { id, url, name: name || null };
  listings.push(newLot);
  saveListings();
  if (!history[id]) history[id] = [];
  saveHistory();
  startLoop(newLot);
  res.json({ ok:true, id });
});

app.delete('/api/listings/:id', (req, res) => {
  const { id } = req.params;
  listings = listings.filter(l => l.id !== id);
  saveListings();
  state.delete(id);
  alertState.delete(id);
  delete history[id];
  saveHistory();
  io.emit('listing:remove', { id });
  res.json({ ok:true });
});

app.post('/api/listings/:id/name', (req, res) => {
  const { id } = req.params;
  const { name } = req.body || {};
  if (!name || typeof name !== 'string') return res.status(400).json({ ok:false, error:'Missing name' });
  let found=false;
  listings = listings.map(l => { if(l.id===id){ found=true; return { ...l, name }; } return l; });
  if (!found) return res.status(404).json({ ok:false, error:'Listing not found' });
  saveListings();
  const cur = state.get(id); if (cur){ cur.meta = { ...cur.meta, displayName: name }; state.set(id, cur); broadcast(id); }
  res.json({ ok:true });
});

// --------- scheduling ---------
const refreshSecondsDefault = Number(process.env.REFRESH_SECONDS || 37);
function computeNextIntervalMs(endsAtISO){
  try{
    if(!endsAtISO) return refreshSecondsDefault*1000;
    const remain = new Date(endsAtISO).getTime() - Date.now();
    return (remain <= 30*60*1000) ? 7000 : (refreshSecondsDefault*1000);
  }catch{ return refreshSecondsDefault*1000; }
}

// --------- Discord alerts ---------
let WEBHOOK = (process.env.DISCORD_WEBHOOK_URL||settings.discordWebhookUrl||'').trim();
let ALERT_NEW_BID = settings.alertOnNewBid ?? (String(process.env.ALERT_ON_NEW_BID||'true').toLowerCase()==='true');
let ALERT_30M = settings.alertOn30min ?? (String(process.env.ALERT_ON_30MIN||'true').toLowerCase()==='true');
let ALERT_CD_MS = Math.max(1, Number(process.env.ALERT_COOLDOWN_MINUTES||settings.alertCooldownMinutes||'10'))*60*1000;

async function sendDiscord({ content }){
  if(!WEBHOOK) return;
  try {
    await fetch(WEBHOOK, {
      method:'POST', headers: { 'Content-Type':'application/json' },
      body: JSON.stringify({ content })
    });
  } catch (e) { console.error('Discord webhook error:', e.message || e); }
}

function iso(){ return new Date().toISOString(); }
function eqAmount(a,b){ if(a==null||b==null) return false; return Math.abs(Number(a)-Number(b))<1e-6; }
function timeMs(x){ return x ? new Date(x).getTime() : NaN; }
function betterSourceRank(src){ const s=String(src||''); if(s==='observed') return 3; if(s==='scraped-time') return 2; if(s==='scraped-date') return 1; return 0; }

function mergeBidsPersist(id, scrapedBids){
  const list = history[id] || (history[id]=[]);
  let changed = false;

  // 1) add/upgrade from scraped
  for (const s of (scrapedBids||[])){
    const src = s.timeISO ? 'scraped-time' : 'scraped-date';
    // Try to find a candidate in existing list with same amount
    let bestIdx = -1; let bestRank = -1;
    for (let i=0;i<list.length;i++){
      const x = list[i];
      if (!eqAmount(x.amount, s.amount)) continue;
      // closeness heuristic: if both have time -> 10min window, else if date-only within 14 days window
      const tS = timeMs(s.timeISO || s.dateISO);
      const tX = timeMs(x.timeISO || x.dateISO);
      const close = isFinite(tS)&&isFinite(tX) ? Math.abs(tS - tX) <= 10*60*1000 : false;
      const near = isFinite(tS)&&isFinite(tX) ? Math.abs(tS - tX) <= 14*24*60*60*1000 : false;

      // same day/date-only also counts as near
      const sameDay = (s.dateISO && x.dateISO) && (new Date(s.dateISO).toDateString() === new Date(x.dateISO).toDateString());

      if (close || near || sameDay || (!x.timeISO && s.timeISO)){
        const rank = betterSourceRank(x.source);
        if (rank > bestRank){ bestRank = rank; bestIdx = i; }
      }
    }
    if (bestIdx >= 0){
      // Upgrade existing if new has better precision
      const x = list[bestIdx];
      const newRank = betterSourceRank(src);
      const curRank = betterSourceRank(x.source);
      if (newRank > curRank){
        x.timeISO = s.timeISO || x.timeISO || null;
        x.dateISO = s.dateISO || (x.timeISO ? null : x.dateISO) || null;
        x.source = src;
        changed = true;
      }
      // ensure amountText present
      if (!x.amountText && s.amountText){ x.amountText = s.amountText; changed = true; }
    } else {
      list.push({ ...s, source: src });
      changed = true;
    }
  }

  // 2) collapse duplicates: keep one per (amount) per ~10min bucket, choosing best source
  list.sort((a,b)=> new Date((a.timeISO||a.dateISO)) - new Date((b.timeISO||b.dateISO)));
  const collapsed = [];
  for (const x of list){
    let kept = true;
    for (let i=collapsed.length-1; i>=0; i--){
      const y = collapsed[i];
      if (!eqAmount(x.amount, y.amount)) continue;
      const tx = timeMs(x.timeISO||x.dateISO);
      const ty = timeMs(y.timeISO||y.dateISO);
      if (isFinite(tx) && isFinite(ty) && Math.abs(tx-ty) <= 10*60*1000){
        // pick better source
        const xr = betterSourceRank(x.source), yr = betterSourceRank(y.source);
        if (xr > yr){ collapsed[i] = { ...y, ...x }; } // replace with better
        kept = false; break;
      }
      // same day & both date-only -> keep one
      if (!x.timeISO && !y.timeISO && x.dateISO && y.dateISO &&
          new Date(x.dateISO).toDateString() === new Date(y.dateISO).toDateString()){
        kept = false; break;
      }
    }
    if (kept) collapsed.push(x);
  }

  history[id] = collapsed;
  if (changed) saveHistory();
  return collapsed.slice();
}
async function startLoop(item){
  const id = item.id;
  if (!history[id]) history[id] = [];
  state.set(id, {
    id, url: item.url,
    meta: { title: 'Loading…', ...(item.name?{displayName:item.name}:{}) },
    bids: [], endsAt: null, lastUpdated: null, currentInterval: refreshSecondsDefault*1000,
    currentPrice: null, lastChangeAt: null, image: null
  });
  alertState.set(id, { lastBidAmount: null, lastBidAlertAtISO: null, lastAlert30mAtISO: null });

  const scraper = global.scraper;

  (async function loop(){
    let nextDelay = refreshSecondsDefault*1000;
    try {
      const r = await scraper.fetch(item.url);
      const prev = state.get(id) || {};
      const displayName = prev?.meta?.displayName || item.name || null;
      nextDelay = computeNextIntervalMs(r.endsAt);

      // Reconcile history with scraped bids
      const mergedHistory = mergeBidsPersist(id, r.bids || []);

      // Detect new bid from price change; add an observed bid with exact timestamp
      const prevAmount = prev.currentPrice ?? null;
      const newAmount = Number.isFinite(r.currentPrice) ? r.currentPrice : prevAmount;
      let lastChangeAt = prev.lastChangeAt || null;
      if (Number.isFinite(newAmount) && newAmount !== prevAmount){
        lastChangeAt = iso();

        // Only push observed if the scraped table does NOT already contain this as the top-most recent row
        const hasRecentSame = (r.bids || []).some(b => Number.isFinite(b.amount) && Math.abs(Number(b.amount) - newAmount) < 1e-6);
        if (!hasRecentSame){
          history[id].push({
            amount: newAmount,
            amountText: `€ ${newAmount.toFixed(2).replace('.',',')}`,
            timeISO: iso(),
            source: 'observed'
          });
          saveHistory();
        }
      }
// Compose output bids: union of history (after possible new observed push), sorted desc by (time||date)
      const outBids = (history[id]||[]).slice().sort((a,b)=> new Date((b.timeISO||b.dateISO)) - new Date((a.timeISO||a.dateISO))).slice(0,60);

      state.set(id, {
        id,
        url: item.url,
        meta: { title: r.title, currency: r.currency, ...(displayName?{displayName}:{}) },
        bids: outBids,
        endsAt: r.endsAt,
        currentPrice: Number.isFinite(newAmount) ? newAmount : null,
        lastChangeAt,
        lastUpdated: iso(),
        currentInterval: nextDelay,
        image: r.image || prev.image || null
      });
      broadcast(id);

      // Alerts
      const a = alertState.get(id) || {};
      if (WEBHOOK){
        if (ALERT_NEW_BID && Number.isFinite(newAmount) && newAmount !== a.lastBidAmount){
          const now = Date.now();
          const lastAt = a.lastBidAlertAtISO ? new Date(a.lastBidAlertAtISO).getTime() : 0;
          if (now - lastAt > ALERT_CD_MS){
            await sendDiscord({ content: `📈 **New bid** on ${displayName || r.title} — now €${newAmount.toFixed(2).replace('.', ',')} \n${item.url}` });
            a.lastBidAlertAtISO = iso();
          }
          a.lastBidAmount = newAmount;
        }
        if (ALERT_30M && r.endsAt){
          const remain = new Date(r.endsAt).getTime() - Date.now();
          if (remain > 0 && remain <= 30*60*1000){
            const now = Date.now();
            const last = a.lastAlert30mAtISO ? new Date(a.lastAlert30mAtISO).getTime() : 0;
            if (now - last > ALERT_CD_MS){
              await sendDiscord({ content: `⏳ **< 30 minutes** left on ${displayName || r.title}\nEnds at: ${new Date(r.endsAt).toLocaleString('nl-NL')} \n${item.url}` });
              a.lastAlert30mAtISO = iso();
            }
          }
        }
      }
      alertState.set(id, a);
    } catch (e){
      const prev = state.get(id) || {};
      state.set(id, {
        ...prev, id, url: item.url,
        meta: { ...(prev.meta||{}), error: e.message },
        lastUpdated: iso(),
        currentInterval: refreshSecondsDefault*1000
      });
      broadcast(id);
    } finally {
      setTimeout(loop, nextDelay);
    }
  })();
}

async function main(){
  const scraper = await createScraper({ headless: (process.env.HEADLESS || 'true').toLowerCase()==='true' });
  global.scraper = scraper;
  for (const item of listings) startLoop(item);
  httpServer.listen(PORT, ()=> console.log(`Auction tracker on http://localhost:${PORT}`));
}
main();
