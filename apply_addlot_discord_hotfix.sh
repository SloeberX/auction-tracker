#!/usr/bin/env bash
set -euo pipefail

SERVER="server.js"
ENV=".env.example"
DISCORD_FILE="server/discord.js"

test -f "$SERVER" || { echo "[hotfix] Run this from repo root (server.js not found)"; exit 1; }
test -f "$DISCORD_FILE" || { echo "[hotfix] server/discord.js not found (zip unpack issue)"; exit 1; }

# 1) Ensure express.json() is enabled right after const app = express();
if ! grep -q "app.use(express.json" "$SERVER"; then
  awk '{
    print;
    if ($0 ~ /const[[:space:]]+app[[:space:]]*=[[:space:]]*express\(\)[[:space:]]*;/ && !done) {
      print "app.use(express.json({ limit: '\''512kb'\'' }));";
      done=1
    }
  }' done=0 "$SERVER" > "$SERVER.tmp" && mv "$SERVER.tmp" "$SERVER"
  echo "[hotfix] Inserted app.use(express.json())."
fi

# 2) Make /api/listings respond with fresh file reads (so UI sees new lots immediately)
if grep -n "app.get('/api/listings'" "$SERVER" >/dev/null; then
  awk '
    BEGIN{inroute=0}
    /app.get..\/api\/listings./ {print; inroute=1; next}
    inroute==1 && /\)\);/ { 
      print "  try{"
      print "    const fs = await import('\''node:fs'\'' ); const path = await import('\''node:path'\'');"
      print "    const dir = typeof __dirname !== '\''undefined'\'' ? __dirname : process.cwd();"
      print "    const read = (p, f)=>{ try{ return JSON.parse(fs.readFileSync(path.join(dir, '\''data'\'', f), '\''utf8'\'')); }catch{ return (f.endsWith('\''json'\'')&&f.includes('\''listings'\''))?[]:{} } };"
      print "    const L = read(dir, '\''listings.json'\''); const H = read(dir, '\''history.json'\''); const S = read(dir, '\''settings.json'\'');"
      print "    res.json({ listings: L, history: H, settings: S });"
      print "  }catch{ res.json({ listings: [], history: {}, settings: {} }) }"
      print "});"
      inroute=0; next
    }
    inroute==1 {next}
    {print}
  ' "$SERVER" > "$SERVER.tmp" && mv "$SERVER.tmp" "$SERVER"
  echo "[hotfix] Rewrote /api/listings to read data files on each request."
fi

# 3) Add /api/add route if missing
if ! grep -q "app.post('/api/add'" "$SERVER"; then
  cat >> "$SERVER" <<'EOF_ADD'

// --- Hotfix: add-lot endpoint ---
app.post('/api/add', async (req,res)=>{
  try{
    const { url, title } = req.body || {};
    if (!url || typeof url !== 'string') return res.status(400).json({ ok:false, error:'missing url' });
    const fs = await import('node:fs'); const path = await import('node:path');
    const dir = (typeof __dirname !== 'undefined') ? __dirname : process.cwd();
    const file = path.join(dir, 'data', 'listings.json');
    let arr=[]; try{ arr = JSON.parse(fs.readFileSync(file,'utf8')); }catch{ arr=[]; }
    const id = 'id-' + Math.random().toString(36).slice(2,10);
    const entry = { id, url, title: title || url, image:'', endsAt:null, price:null };
    arr.unshift(entry);
    fs.writeFileSync(file, JSON.stringify(arr,null,2));

    // Discord webhook (optional)
    const webhook = (process.env.DISCORD_WEBHOOK_URL||'').trim();
    if (webhook) {
      try {
        const mod = await import('./server/discord.js');
        mod.sendDiscordEmbed(webhook, { title: entry.title, url: entry.url, price: entry.price, endsAt: entry.endsAt });
      } catch {}
    }
    return res.json({ ok:true, id });
  }catch(e){
    return res.status(500).json({ ok:false, error:String(e?.message||e) });
  }
});
EOF_ADD
  echo "[hotfix] Added /api/add route."
fi

# 4) ensure DISCORD_WEBHOOK_URL exists in .env.example
touch "$ENV"
grep -q "^DISCORD_WEBHOOK_URL=" "$ENV" || echo "DISCORD_WEBHOOK_URL=" >> "$ENV"
echo "[hotfix] Updated .env.example (DISCORD_WEBHOOK_URL)."

echo "[hotfix] Complete."
