#!/bin/bash
set -e
echo "[public-fix] Applying /public alias patch..."

# Add /public static alias if not present
if ! grep -q "app.use('/public'" server.js; then
  sed -i "/express.static/a app.use('/public', express.static(path.join(process.cwd(), 'public')));" server.js
fi

# Fix client.js path in HTML
sed -i "s#/public/client.js#/client.js#g" public/index.html || true

echo "[public-fix] Done."
