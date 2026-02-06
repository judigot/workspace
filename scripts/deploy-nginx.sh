#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ROOT_DIR=$(cd "${SCRIPT_DIR}/.." && pwd)
ENV_FILE="${ROOT_DIR}/.env"

# Source .env so generate-nginx.sh picks up APPS, DOMAIN, etc.
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

OUTPUT_PATH=${OUTPUT_PATH:-"${ROOT_DIR}/dist/nginx.conf"}
TARGET_PATH=${TARGET_PATH:-"/etc/nginx/sites-available/default"}

"${SCRIPT_DIR}/generate-nginx.sh" "${OUTPUT_PATH}"

# Copy DevBubble widget to static serving directory
WIDGET_SRC="${ROOT_DIR}/dist/dev-bubble.js"
WIDGET_DEST="${WIDGET_DIR:-/var/www/static}/dev-bubble.js"
if [ -f "$WIDGET_SRC" ]; then
  sudo mkdir -p "$(dirname "$WIDGET_DEST")"
  sudo cp "$WIDGET_SRC" "$WIDGET_DEST"
  sudo chown www-data:www-data "$WIDGET_DEST"
fi

sudo cp "${OUTPUT_PATH}" "${TARGET_PATH}"
sudo nginx -t
sudo systemctl reload nginx

echo "Deployed nginx config to ${TARGET_PATH}"
