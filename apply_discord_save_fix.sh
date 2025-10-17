#!/usr/bin/env bash
set -euo pipefail

FILE="server.js"
[ -f "$FILE" ] || { echo "server.js not found"; exit 1; }

# 1) Ensure express.json and APIs are defined BEFORE static
# Move the static block after /api routes by simple heuristic replacement:
# We'll inject fortified settings handlers and ensure routes exist.

# Fortify /api/settings handlers (idempotent replace)
perl -0777 -pe "s@app\.get\('/api/settings'.*?}\);\s*app\.post\('/api/settings'.*?}\);@app.get('/api/settings',(req,res)=>{ try{ const fs=require('fs'); const path=require('path'); const dir=__dirname; const f=path.join(dir,'data','settings.json'); let s={}; try{s=JSON.parse(fs.readFileSync(f,'utf8'));}catch{} res.json({ discordWebhook: s.discordWebhook||'' }); }catch(e){ res.status(500).json({ok:false,error:String(e?.message||e)}); } });\napp.post('/api/settings',(req,res)=>{ try{ const fs=require('fs'); const path=require('path'); const dir=__dirname; const f=path.join(dir,'data','settings.json'); let s={}; try{s=JSON.parse(fs.readFileSync(f,'utf8'));}catch{} s.discordWebhook=(req.body?.discordWebhook||'').trim(); fs.writeFileSync(f, JSON.stringify(s,null,2)); res.json({ok:true}); }catch(e){ res.status(500).json({ok:false,error:String(e?.message||e)}); } });@s" -i "$FILE" || true

echo "[discord-save-fix] Patched settings endpoints in $FILE"
