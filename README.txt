Auction Tracker — Emergency Recover Pack
=============================================

What this does (safe, minimal changes):
- Brings back a working Web UI (index.html + client.js) with Discord button + per-card "Send to Discord".
- Adds robust start/stop/restart scripts that PREVENT duplicate Node processes (no more EADDRINUSE).
- Does NOT wipe your data.
- Does NOT touch your scraper logic.

How to apply (Windows → GitHub):
--------------------------------
cd /d/Downloads/auction-tracker
unzip -o /d/Downloads/auction-tracker-emergency-recover.zip -d .

git add -A
git commit -m "Emergency recover: stable UI + start/stop scripts (no data loss)"
git push --force-with-lease

LXC pull & start (Proxmox):
---------------------------
cd /opt
sudo rm -rf auction-tracker
sudo git clone https://github.com/SloeberX/auction-tracker.git
cd auction-tracker

npm i
npx playwright install --with-deps chromium

# keep your env
cp .env.example .env
sed -i 's/^NO_SANDBOX=.*/NO_SANDBOX=true/' .env
sed -i 's/^HEADLESS=.*/HEADLESS=true/' .env
sed -i 's/^LOG_LEVEL=.*/LOG_LEVEL=info/' .env
sed -i 's/^AUTO_RESTORE=.*/AUTO_RESTORE=true/' .env
sed -i 's/^LIGHT_MODE=.*/LIGHT_MODE=true/' .env

# Start clean (prevents duplicates)
bash scripts/start.sh

Sanity checks:
--------------
curl -I http://127.0.0.1:3000/
curl -I http://127.0.0.1:3000/client.js
curl -sS http://127.0.0.1:3000/api/listings | head -c 400; echo

If the UI shows 0 listings:
---------------------------
You previously created empty JSONs. Restore a backup if present:
  bash restore_last_backup.sh
Or re-add lots via the UI's "Add lot" button.

Stop/Restart helpers:
---------------------
bash scripts/status.sh
bash scripts/stop.sh
bash scripts/restart.sh
