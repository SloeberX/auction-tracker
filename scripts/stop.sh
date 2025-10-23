#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f server.pid ] && kill -TERM $(cat server.pid) 2>/dev/null || true
pkill -f "node server.js" 2>/dev/null || true
fuser -k -n tcp 3000 2>/dev/null || true
rm -f server.pid
echo "[stop] done"
