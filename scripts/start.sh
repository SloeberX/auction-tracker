#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

# stop anything on :3000
pkill -f "node server.js" 2>/dev/null || true
fuser -k -n tcp 3000 2>/dev/null || true
sleep 1

# ensure data files exist (do NOT overwrite if they exist)
mkdir -p data
[ -f data/listings.json ] || echo "[]"  > data/listings.json
[ -f data/history.json ]  || echo "{}"  > data/history.json
[ -f data/settings.json ] || echo "{}"  > data/settings.json

# start detached
nohup node server.js >/opt/auction-tracker/server.log 2>&1 & echo $! > server.pid
sleep 1
echo "[start] PID $(cat server.pid)"
ss -lptn 'sport = :3000' || true
