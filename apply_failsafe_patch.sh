#!/usr/bin/env bash
set -euo pipefail

ROOT="$(pwd)"
SERVER="$ROOT/server.js"
CLIENT="$ROOT/public/client.js"
ENV_EXAMPLE="$ROOT/.env.example"

if [[ ! -f "$SERVER" || ! -f "$CLIENT" ]]; then
  echo "[failsafe] Run this from your repo root (where server.js and public/ exist)."
  exit 1
fi

echo "[failsafe] 0) Ensure .env.example contains new keys"
grep -q "^AUTO_RESTORE=" "$ENV_EXAMPLE" || echo "AUTO_RESTORE=true" >> "$ENV_EXAMPLE"
grep -q "^BACKUP_INTERVAL_HOURS=" "$ENV_EXAMPLE" || echo "BACKUP_INTERVAL_HOURS=6" >> "$ENV_EXAMPLE"
grep -q "^MAX_BACKUPS=" "$ENV_EXAMPLE" || echo "MAX_BACKUPS=10" >> "$ENV_EXAMPLE"
grep -q "^LIGHT_MODE=" "$ENV_EXAMPLE" || echo "LIGHT_MODE=true" >> "$ENV_EXAMPLE"

echo "[failsafe] 1) Inject no-cache headers for static assets"
if ! grep -q "no-store, no-cache" "$SERVER"; then
  sed -i 's@app.use(express.static(path.join(__dirname, '\''public'\'')));@app.use((req,res,next)=>{ res.set('\''Cache-Control'\'','\''no-store, no-cache, must-revalidate, proxy-revalidate'\''); res.set('\''Pragma'\'','\''no-cache'\''); res.set('\''Expires'\'','\''0'\''); next(); });\napp.use(express.static(path.join(__dirname, '\''public'\'')));@' "$SERVER"
fi

echo "[failsafe] 2) Append data safety toolkit (backups, restore, atomic save, dedupe)"
if ! grep -q "/* Failsafe Data Toolkit */" "$SERVER"; then
  cat >> "$SERVER" <<'EOF_FS'

/* Failsafe Data Toolkit */
import fs from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data');
const BAK_DIR = path.join(DATA_DIR, 'backups');

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
  try{
    const txt = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(txt);
  }catch(e){
    return fallback;
  }
}

function listBackupsSorted(){
  try{
    const entries = fs.readdirSync(BAK_DIR).map(name => ({
      name,
      full: path.join(BAK_DIR, name),
      mtime: fs.statSync(path.join(BAK_DIR, name)).mtimeMs
    })).filter(e => fs.existsSync(path.join(e.full, 'listings.json')) && fs.existsSync(path.join(e.full, 'history.json')));
    return entries.sort((a,b)=>b.mtime - a.mtime);
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
    console.log('[backup] snapshot created at', dir);
  }catch(e){ console.error('[backup] failed', e?.message||e); }
}

function pruneBackups(){
  try{
    const THIRTY_DAYS = 30*24*3600*1000;
    const now = Date.now();
    const entries = fs.readdirSync(BAK_DIR).map(name => ({
      name,
      full: path.join(BAK_DIR, name),
      mtime: fs.statSync(path.join(BAK_DIR, name)).mtimeMs
    }));
    for (const e of entries){
      if (now - e.mtime > THIRTY_DAYS){
        fs.rmSync(e.full, { recursive:true, force:true });
        console.log('[backup] pruned old backup', e.name);
      }
    }
  }catch(e){ /* ignore */ }
}

function autoRestoreIfCorrupt(){
  ensureDirs();
  let listings = null, history = null, settings = null, needRestore=false;
  try{ listings = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'listings.json'), 'utf8')); }catch{ needRestore = true; }
  try{ history  = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'history.json'), 'utf8')); }catch{ needRestore = true; }
  try{ settings = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'settings.json'), 'utf8')); }catch{ /* ignore */ }
  if (!Array.isArray(listings)) needRestore = true;
  if (history && typeof history !== 'object') needRestore = true;
  if (!needRestore) return false;

  const backups = listBackupsSorted();
  if (backups.length){
    const src = backups[0].full;
    for (const f of ['listings.json','history.json','settings.json']){
      const s = path.join(src, f), d = path.join(DATA_DIR, f);
      try{ fs.copyFileSync(s, d); }catch{ fs.writeFileSync(d, f==='history.json' ? '{}' : '[]'); }
    }
    console.warn('[restore] Auto-restore triggered from', backups[0].name);
    return true;
  }else{
    // create fresh files
    try{ fs.writeFileSync(path.join(DATA_DIR,'listings.json'),'[]'); }catch{}
    try{ fs.writeFileSync(path.join(DATA_DIR,'history.json'),'{}'); }catch{}
    console.warn('[restore] No backups found. Created fresh data files.');
    return true;
  }
}

function dedupeHistoryFile(){
  try{
    const p = path.join(DATA_DIR, 'history.json');
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
    atomicWrite(p, JSON.stringify(out, null, 2));
    console.log('[dedupe] history cleaned');
  }catch(e){ console.error('[dedupe] failed', e?.message||e); }
}

function initDataSafety(){
  try{
    ensureDirs();
    const restored = process.env.AUTO_RESTORE === 'true' ? autoRestoreIfCorrupt() : false;
    pruneBackups();
    createBackupNow(restored ? 'after-restore' : 'startup');
    dedupeHistoryFile();
    // schedule periodic backups
    const hours = Number(process.env.BACKUP_INTERVAL_HOURS || 6);
    setInterval(() => { createBackupNow('periodic'); pruneBackups(); }, Math.max(1, hours)*3600*1000);
    // graceful shutdown
    for (const sig of ['SIGINT','SIGTERM']){
      try{
        process.on(sig, () => {
          try { createBackupNow('shutdown'); } catch {}
          setTimeout(()=>process.exit(0), 100);
        });
      }catch{}
    }
  }catch(e){ console.error('[failsafe] init error', e?.message||e); }
}

initDataSafety();
/* End Failsafe Data Toolkit */
EOF_FS
fi

echo "[failsafe] 3) Client hard re-render + single-interval guard"
# Ensure global interval map on top
grep -q "window.__intervals" "$CLIENT" || sed -i '1i window.__intervals = window.__intervals || {};' "$CLIENT"

# Hard clear root at start of renderListings()
awk 'BEGIN{done=0}
{ print }
$0 ~ /function[[:space:]]+renderListings[[:space:]]*\(/ && done==0 {
  print "  const root = document.getElementById('\''root'\'') || document.querySelector('\''.listings'\'') || document.body;";
  print "  if (root) { while (root.firstChild) root.removeChild(root.firstChild); }";
  done=1
}' "$CLIENT" > "$CLIENT.tmp" && mv "$CLIENT.tmp" "$CLIENT"

# Guard startCountdown to avoid duplicate timers
awk 'BEGIN{patched=0}
{ if (!patched && $0 ~ /function[[:space:]]+startCountdown[[:space:]]*\(.*\)[[:space:]]*\{/) {
    print; print "  try{ if (window.__intervals[id]) clearInterval(window.__intervals[id]); }catch(e){}"; patched=1; next
  } print }' "$CLIENT" > "$CLIENT.tmp" && mv "$CLIENT.tmp" "$CLIENT"

echo "[failsafe] Done."
