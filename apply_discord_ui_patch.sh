#!/usr/bin/env bash
set -euo pipefail
echo "[discord-ui] Applying patch..."

cp -f server.js ./server.js
mkdir -p public server
cp -f public/index.html ./public/index.html
cp -f public/client.js ./public/client.js
cp -f server/discord.js ./server/discord.js

echo "[discord-ui] Done. Commit & push."
