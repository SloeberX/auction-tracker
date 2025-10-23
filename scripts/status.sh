#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
echo "[status] socket:"
ss -lptn 'sport = :3000' || true
echo "[status] pid file:"
[ -f server.pid ] && cat server.pid || echo "(none)"
echo "[status] log tail:"
tail -n 40 /opt/auction-tracker/server.log 2>/dev/null || true
