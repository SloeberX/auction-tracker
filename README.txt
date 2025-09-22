Auction Tracker — Complete Build (Discord Embedded)
==================================================

Quickstart
----------
npm i
npx playwright install --with-deps chromium
cp .env.example .env
# For LXC you likely want:
#   NO_SANDBOX=true
#   HEADLESS=true
node server.js
# open http://<container-ip>:3000/

Discord
-------
Click the floating "Discord" button on the page. Paste your webhook and choose:
- @everyone on new bid
- @everyone when < 30 minutes
- Edit interval (seconds)

Settings persist in data/settings.json; runtime message IDs in data/discord-state.json.
