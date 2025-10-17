#!/usr/bin/env bash
set -euo pipefail
DATA="data"
BAK="$DATA/backups"
test -d "$BAK" || { echo "No backups dir"; exit 1; }
last="$(ls -1t "$BAK" | head -n1)"
test -n "$last" || { echo "No backups found"; exit 1; }
echo "Restoring from: $BAK/$last"
cp "$BAK/$last/listings.json" "$DATA/listings.json"
cp "$BAK/$last/history.json"  "$DATA/history.json"
[ -f "$BAK/$last/settings.json" ] && cp "$BAK/$last/settings.json" "$DATA/settings.json" || true
echo "Restore done."
