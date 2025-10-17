# Auction Tracker — Stability Patch
This script applies a tiny, surgical fix:
- No-cache headers on server (prevents stale client.js)
- Hard re-render of the listings grid (prevents old cards/images reappearing)
- Countdown interval guard (no duplicate timers)
- Observed-guard tweak to keep a single timestamped price change

## Usage
From your repo root (where `server.js` and `public/` live):
```bash
bash apply_stability_patch.sh
```

Then commit and push:
```bash
git add -A
git commit -m "Stability patch: no-cache + hard rerender + interval guards + observed dedupe"
git push
```

Deploy to LXC as usual (clone fresh, install, run).
