Auction Tracker — Discord UI Patch
------------------------------------
Adds:
- "Discord" button in the UI to set the webhook (persisted in data/settings.json)
- Per-card "Send to Discord" button
- POST /api/ping-discord to send an embed for a listing now
- GET/POST /api/settings to read/update the webhook
- Sends an embed when a new lot is added and on price/ends changes

How to apply (Git Bash on Windows):
-----------------------------------
cd /d/Downloads/auction-tracker
unzip -o /d/Downloads/auction-tracker-discord-ui-patch.zip -d .
bash apply_discord_ui_patch.sh

git add -A
git commit -m "Discord UI: webhook settings + manual send + auto on add/change"
git push --force-with-lease
