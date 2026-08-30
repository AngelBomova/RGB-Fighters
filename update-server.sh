#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-$HOME/RGB-Fighters}"
WEB_DIR="${WEB_DIR:-/var/www/rgbfighters}"
FRONTEND_URL_VALUE="${FRONTEND_URL:-https://rgbfighters.com}"
USE_SQLITE_VALUE="${USE_SQLITE:-1}"

if [ -z "$WEB_DIR" ] || [ "$WEB_DIR" = "/" ]; then
  exit 1
fi

cd "$APP_DIR"
git pull
npm install
npm run build
mkdir -p "$WEB_DIR"
rm -rf "$WEB_DIR"/*
cp -r dist/* "$WEB_DIR"/

if FRONTEND_URL="$FRONTEND_URL_VALUE" USE_SQLITE="$USE_SQLITE_VALUE" pm2 describe rgb-server >/dev/null 2>&1; then
  FRONTEND_URL="$FRONTEND_URL_VALUE" USE_SQLITE="$USE_SQLITE_VALUE" pm2 restart rgb-server --update-env
else
  FRONTEND_URL="$FRONTEND_URL_VALUE" USE_SQLITE="$USE_SQLITE_VALUE" pm2 start server/index.js --name rgb-server --update-env
fi

pm2 save
nginx -t
systemctl reload nginx
