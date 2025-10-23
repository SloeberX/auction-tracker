#!/usr/bin/env bash
set -euo pipefail

FILE="server.js"
if [ ! -f "$FILE" ]; then
  echo "server.js not found (run from project root)"; exit 1
fi

cp "$FILE" "$FILE.bak.$(date +%s)"

# 1) Relax overly strict CSP if present
if grep -q "Content-Security-Policy" "$FILE"; then
  sed -i "s/default-src 'none'/default-src 'self' 'unsafe-inline' data: blob:/g" "$FILE" || true
fi

# 2) Ensure / and /client.js routes + static mapping exist
if ! grep -q "WEBUI HOTFIX" "$FILE"; then
cat >> "$FILE" <<'EOF'

// ===== WEBUI HOTFIX (idempotent) =====
try {
  const PUB = process.cwd() + '/public';
  app.get('/', (req,res)=> res.sendFile(PUB + '/index.html'));
  app.get('/client.js', (req,res)=> res.sendFile(PUB + '/client.js'));
  const expressMod = await import('express');
  app.use('/public', expressMod.default.static(PUB, { maxAge:0, etag:false, lastModified:false }));
} catch (e) {
  console.error('webui hotfix failed', e);
}
// ===== END WEBUI HOTFIX =====
EOF
fi

echo "[webui-repair] Applied. Now commit/push and restart the server."
