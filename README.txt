Complete restore build with:
- Express server + Socket.IO
- UI cards + add/rename/remove
- Scraper (Auctivo best-effort) with adaptive intervals (37s → 10s when <30m → 5s when <5m)
- Discord webhook on changes
- Data safety (atomic write, backups 30d, dedupe)
- No duplicate fs imports; uses express.json; public alias mounted

How to deploy (Git Bash → GitHub → LXC):

Windows:
  cd /d/Downloads
  unzip -o auction-tracker-complete-restore.zip -d auction-tracker-restore
  cd /d/Downloads/auction-tracker
  cp -r /d/Downloads/auction-tracker-restore/* .
  git add -A
  git commit -m "Restore: stable server + UI + scraper + discord + failsafe"
  git push --force-with-lease

LXC:
  cd /opt
  sudo rm -rf auction-tracker
  sudo git clone https://github.com/USER/REPO.git auction-tracker
  cd auction-tracker
  npm i
  npx playwright install --with-deps chromium
  cp .env.example .env
  sed -i 's/^NO_SANDBOX=.*/NO_SANDBOX=true/' .env
  sed -i 's/^HEADLESS=.*/HEADLESS=true/' .env
  sed -i 's/^LOG_LEVEL=.*/LOG_LEVEL=info/' .env
  sed -i 's/^AUTO_RESTORE=.*/AUTO_RESTORE=true/' .env
  sed -i 's/^LIGHT_MODE=.*/LIGHT_MODE=true/' .env
  echo "DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/XXXX" >> .env
  nohup node server.js >/opt/auction-tracker/server.log 2>&1 &
