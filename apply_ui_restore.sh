#!/usr/bin/env bash
set -euo pipefail

SERVER="server.js"

if [[ ! -f "$SERVER" ]]; then
  echo "[ui-restore] Run this in your repo root (server.js not found)"
  exit 1
fi

# 1) Ensure /public alias exists
if ! grep -q "app.use('/public'" "$SERVER"; then
  awk '{
    print;
    if ($0 ~ /express\.static\(path\.join\(__dirname, '\''public'\''\)\)\);/ && !done) {
      print "app.use('\''/public'\'', express.static(path.join(__dirname, '\''public'\'')));";
      done=1
    }
  }' done=0 "$SERVER" > "$SERVER.tmp" && mv "$SERVER.tmp" "$SERVER"
  echo "[ui-restore] Added /public alias"
fi

# 2) Add /api/add route if missing (very small append)
if ! grep -q "app.post('/api/add'" "$SERVER"; then
  cat >> "$SERVER" <<'EOF_ADD'

// --- Minimal add lot endpoint (append + save) ---
import bodyParser from 'body-parser';
app.use(bodyParser.json({ limit: '256kb' }));

app.post('/api/add', async (req,res)=>{
  try{
    const { url, title } = req.body || {};
    if (!url || typeof url !== 'string') return res.status(400).json({ ok:false, error:'missing url' });
    // create a basic listing entry
    const id = 'id-' + Math.random().toString(36).slice(2,10);
    const entry = { id, url, title: title || url, image: '', endsAt: null, price: null };
    // load current data
    const fsPath = path.join(path.dirname(new URL(import.meta.url).pathname), 'data', 'listings.json');
    let arr=[]; try{ arr = JSON.parse(fs.readFileSync(fsPath,'utf8')); }catch{ arr=[]; }
    arr.unshift(entry);
    fs.writeFileSync(fsPath, JSON.stringify(arr,null,2));
    return res.json({ ok:true, id });
  }catch(e){
    return res.status(500).json({ ok:false, error:String(e?.message||e) });
  }
});
EOF_ADD
  echo "[ui-restore] Added /api/add route"
fi

echo "[ui-restore] server.js patch complete"
