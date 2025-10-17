#!/usr/bin/env bash
set -euo pipefail

ROOT="$(pwd)"
SERVER="$ROOT/server.js"
CLIENT="$ROOT/public/client.js"

if [[ ! -f "$SERVER" || ! -f "$CLIENT" ]]; then
  echo "[patch] Run this in your repo root (where server.js and public/ exist)."
  exit 1
fi

echo "[patch] 1) Add no-cache headers to server.js (prevents stale client.js)"
if ! grep -q "no-store, no-cache" "$SERVER"; then
  # Insert before express.static
  sed -i 's@app.use(express.static(path.join(__dirname, '\''public'\'')));@app.use((req,res,next)=>{ res.set('\''Cache-Control'\'','\''no-store, no-cache, must-revalidate, proxy-revalidate'\''); res.set('\''Pragma'\'','\''no-cache'\''); res.set('\''Expires'\'','\''0'\''); next(); });\napp.use(express.static(path.join(__dirname, '\''public'\'')));@' "$SERVER"
fi

echo "[patch] 2) Strengthen observed guard so we keep a single timestamped change"
# Replace the common guard; if not present, attempt a generic guarded block
if grep -q "r.bids" "$SERVER"; then
  sed -i 's@const hasSame = (r\.bids||\[\]).some(b => Number\.isFinite(b\.amount) && Math\.abs(Number(b\.amount)-newAmount)<1e-6);@const alreadyTimed = (history[id]||[]).some(b => Number.isFinite(b.amount) && Math.abs(Number(b.amount)-newAmount)<1e-6 && !!b.timeISO);\n      if (!alreadyTimed){\n        history[id] = history[id] || [];\n        history[id].push({ amount:newAmount, amountText:`€ ${Number(newAmount).toFixed(2).replace(".",",")}`, timeISO: new Date().toISOString(), source:"observed" });\n        saveHistory();\n      }\n      continue;@' "$SERVER" || true
fi

echo "[patch] 3) Ensure global interval map in client.js"
grep -q "window.__intervals" "$CLIENT" || sed -i '1i window.__intervals = window.__intervals || {};' "$CLIENT"

echo "[patch] 4) Hard clear DOM at the start of renderListings() to avoid card reuse glitches"
awk 'BEGIN{done=0} {print} /function[[:space:]]+renderListings[[:space:]]*\(/ && getline {print; if(!done){print "  const root = document.getElementById('\''root'\'') || document.querySelector('\''.listings'\'') || document.body;"; print "  if (root) { while (root.firstChild) root.removeChild(root.firstChild); }"; done=1}}' "$CLIENT" > "$CLIENT.tmp" && mv "$CLIENT.tmp" "$CLIENT"

echo "[patch] 5) Prevent duplicate countdown timers"
awk 'BEGIN{patched=0} {if(!patched && $0 ~ /function[[:space:]]+startCountdown[[:space:]]*\(.*\)[[:space:]]*\{/){print; print "  try{ if (window.__intervals[id]) { clearInterval(window.__intervals[id]); } }catch(e){}"; patched=1; next} print}' "$CLIENT" > "$CLIENT.tmp" && mv "$CLIENT.tmp" "$CLIENT"

echo "[patch] Done."
