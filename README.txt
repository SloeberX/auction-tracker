# Auction Tracker — Long-term Stable Failsafe Patch
This patch adds:
- Auto-restore from the newest backup if JSON is missing/corrupt
- 30-day backup pruning + periodic backups (BACKUP_INTERVAL_HOURS)
- Atomic JSON writes, dedupe on boot, graceful shutdown backups
- No-cache headers for static files
- Client hard re-render and single-interval countdown guard

## Usage
From your repo root (where `server.js` and `public/` live):
```bash
bash apply_failsafe_patch.sh
```

Then commit and push:
```bash
git add -A
git commit -m "Failsafe: auto-restore + 30d backup cleanup + dedupe + atomic writes"
git push --force-with-lease
```

Helpers:
```bash
bash restore_last_backup.sh
bash verify_data_integrity.sh
```
