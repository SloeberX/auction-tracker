#!/usr/bin/env bash
set -euo pipefail

SERVER="server.js"
if [[ ! -f "$SERVER" ]]; then
  echo "[fsfix] Run this in your repo root (server.js not found)"
  exit 1
fi

# Read whole file
content="$(cat "$SERVER")"

startMarker="/* Failsafe Data Toolkit */"
endMarker="/* End Failsafe Data Toolkit */"

startIndex=$(awk -v a="$startMarker" '{pos=index($0,a); if(pos){print NR; exit}}' "$SERVER" || true)
endIndex=$(awk -v a="$endMarker" '{pos=index($0,a); if(pos){print NR; exit}}' "$SERVER" || true)

if [[ -z "${startIndex:-}" || -z "${endIndex:-}" ]]; then
  echo "[fsfix] Failsafe block markers not found; server.js may already be fixed."
  exit 0
fi

# Create temp files for manipulation with awk/sed
TMP="$SERVER.tmp"
cp "$SERVER" "$TMP"

# Replace the mid-file ESM imports with dynamic imports, and alias usages.
# 1) within failsafe block, turn `import fs from 'fs';` -> `const FS = await import('node:fs');`
#    and `import path from 'path';` -> `const PATH = await import('node:path');`
# 2) replace occurrences of `fs.` -> `FS.` and `path.` -> `PATH.` only inside that block.

awk -v start="$startMarker" -v end="$endMarker" '
  BEGIN{ in=0 }
  {
    if(index($0, start)) { in=1 }
    if(in==1){
      gsub(/^import[[:space:]]+fs[[:space:]]+from[[:space:]]+.\x27fs\x27;[[:space:]]*$/, "const FS = await import(\x27node:fs\x27);");
      gsub(/^import[[:space:]]+path[[:space:]]+from[[:space:]]+.\x27path\x27;[[:space:]]*$/, "const PATH = await import(\x27node:path\x27);");
      gsub(/(^|[^A-Za-z0-9_])fs\./, "\\1FS.");
      gsub(/(^|[^A-Za-z0-9_])path\./, "\\1PATH.");
    }
    print $0
    if(index($0, end)) { in=0 }
  }
' "$TMP" > "$SERVER"

rm -f "$TMP"

echo "[fsfix] Applied Git Bash dynamic import alias (FS/PATH) in Failsafe block."
