// Discord webhook module (embedded routes + update logic)
import fs from "fs";
import path from "path";
import express from "express";

const settingsPath = path.join(process.cwd(), "data", "settings.json");
export function loadSettings() {
  try { const j = JSON.parse(fs.readFileSync(settingsPath, "utf8")); return j.discord || {}; }
  catch { return {}; }
}
export function saveSettings(next) {
  let base = {};
  try { base = JSON.parse(fs.readFileSync(settingsPath, "utf8")); } catch {}
  base.discord = next;
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(base, null, 2));
}

const statePath = path.join(process.cwd(), "data", "discord-state.json");
let runtime = { lots: {} };
try { runtime = JSON.parse(fs.readFileSync(statePath, "utf8")); } catch {}
function flushState(){ fs.mkdirSync(path.dirname(statePath), { recursive: true }); fs.writeFileSync(statePath, JSON.stringify(runtime, null, 2)); }
function lotKey(url){ return Buffer.from(url).toString("base64"); }

function toUnixSeconds(iso){ if(!iso) return null; const t = new Date(iso).getTime(); return Number.isNaN(t) ? null : Math.floor(t/1000); }
function timeLeft(iso){ if(!iso) return null; return new Date(iso).getTime() - Date.now(); }
function within30m(iso){ const ms = timeLeft(iso); return ms!=null && ms>0 && ms <= 30*60*1000; }
function euro(amount){ if(amount==null) return "—"; return "€ " + Number(amount).toFixed(2).replace(".", ","); }

function buildEmbed({ lot, nowISO }){
  const endsUnix = toUnixSeconds(lot.endsAt);
  const fields = [{ name:"Price", value:euro(lot.currentPrice), inline:true }];
  if (endsUnix) fields.push({ name:"Ends", value:`<t:${endsUnix}:F>\n<t:${endsUnix}:R>`, inline:true });
  if (lot.lastChangeAt){ const lc = toUnixSeconds(lot.lastChangeAt); if (lc) fields.push({ name:"Last change", value:`<t:${lc}:R>`, inline:true }); }
  return {
    username: "Auction Tracker",
    embeds: [{
      title: lot.title || "Auction lot",
      url: lot.url,
      description: lot.alias ? `**${lot.alias}**` : undefined,
      image: lot.image ? { url: lot.image } : undefined,
      color: within30m(lot.endsAt) ? 0xff4d4f : 0x5865f2,
      fields,
      timestamp: nowISO,
      footer: { text: "Live updates via Auction Tracker" }
    }]
  };
}

async function sendMessage({ webhook, payload, pingEveryone }){
  const url = `${webhook}?wait=true`;
  const body = { ...payload };
  if (pingEveryone) body.content = "@everyone";
  const r = await fetch(url, { method:"POST", headers:{ "content-type":"application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`Discord POST ${r.status}`);
  return await r.json();
}
async function editMessage({ webhook, messageId, payload }){
  const url = `${webhook}/messages/${messageId}`;
  const r = await fetch(url, { method:"PATCH", headers:{ "content-type":"application/json" }, body: JSON.stringify(payload) });
  if (!r.ok) throw new Error(`Discord PATCH ${r.status}`);
  return await r.json();
}

export async function handleDiscordTick(lot, settings){
  if (!settings?.enabled || !settings?.webhookUrl) return;
  const key = lotKey(lot.url);
  if (!runtime.lots[key]) runtime.lots[key] = {};
  const st = runtime.lots[key];

  const now = new Date();
  const nowISO = now.toISOString();
  const is30m = within30m(lot.endsAt);
  const latestPrice = lot.currentPrice ?? null;
  const lastKnown = st.lastKnownPrice ?? null;
  const priceChanged = latestPrice!=null && lastKnown!=null && latestPrice !== lastKnown;
  const minGap = (settings.updateIntervalSec || 60)*1000;
  const canEdit = !st.lastEditAt || (now.getTime() - st.lastEditAt) > minGap;

  // New bid -> new message + ping
  if (settings.pingOnNewBid && priceChanged){
    const payload = buildEmbed({ lot, nowISO });
    try {
      const msg = await sendMessage({ webhook: settings.webhookUrl, payload, pingEveryone:true });
      st.messageId = msg.id; st.lastKnownPrice = latestPrice; st.lastEditAt = now.getTime(); flushState();
    } catch {}
    return;
  }
  // <30m -> new message + ping (<=1/min)
  if (settings.pingAt30m && is30m){
    if (!st.last30mPingAt || (now.getTime() - st.last30mPingAt) > 60*1000){
      const payload = buildEmbed({ lot, nowISO });
      try {
        const msg = await sendMessage({ webhook: settings.webhookUrl, payload, pingEveryone:true });
        st.messageId = msg.id; st.last30mPingAt = now.getTime(); st.lastKnownPrice = latestPrice ?? st.lastKnownPrice; st.lastEditAt = now.getTime(); flushState();
      } catch {}
    }
    return;
  }
  // Normal -> edit/create (throttled)
  if (!canEdit) return;
  const payload = buildEmbed({ lot, nowISO });
  try {
    if (st.messageId){
      await editMessage({ webhook: settings.webhookUrl, messageId: st.messageId, payload });
    } else {
      const msg = await sendMessage({ webhook: settings.webhookUrl, payload, pingEveryone:false });
      st.messageId = msg.id;
    }
    st.lastKnownPrice = latestPrice ?? st.lastKnownPrice; st.lastEditAt = now.getTime(); flushState();
  } catch {}
}

export function registerDiscordRoutes(app){
  app.get("/api/discord/settings", (_req,res)=> res.json(loadSettings()));
  app.post("/api/discord/settings", express.json(), (req,res)=>{
    const next = {
      enabled: !!req.body.enabled,
      webhookUrl: String(req.body.webhookUrl || ""),
      pingOnNewBid: !!req.body.pingOnNewBid,
      pingAt30m: !!req.body.pingAt30m,
      updateIntervalSec: Math.max(15, Number(req.body.updateIntervalSec || 60))
    };
    saveSettings(next); res.json({ ok:true });
  });
  app.post("/api/discord/test", async (_req,res)=>{
    try{
      const s = loadSettings(); if(!s?.webhookUrl) return res.status(400).json({ error:"No webhook" });
      const lot = { title:"Test embed", alias:"Auction Tracker", url:"https://example.com/", image:"https://i.imgur.com/4f3J3rJ.png",
        currentPrice:12.34, endsAt:new Date(Date.now()+3600*1000).toISOString(), lastChangeAt:new Date().toISOString() };
      await handleDiscordTick(lot, { ...s, pingOnNewBid:true });
      res.json({ ok:true });
    }catch(e){ res.status(500).json({ error:String(e) }); }
  });
}
