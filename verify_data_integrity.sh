#!/usr/bin/env bash
set -euo pipefail
echo "Verifying data files..."
for f in data/listings.json data/history.json data/settings.json; do
  if [[ -f "$f" ]]; then
    node -e "JSON.parse(require('fs').readFileSync('$f','utf8'))" && echo "[OK] $f" || echo "[BAD] $f"
  else
    echo "[MISS] $f"
  fi
done
