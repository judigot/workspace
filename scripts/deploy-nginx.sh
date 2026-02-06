#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ROOT_DIR=$(cd "${SCRIPT_DIR}/.." && pwd)

OUTPUT_PATH=${OUTPUT_PATH:-"${ROOT_DIR}/dist/nginx.conf"}
TARGET_PATH=${TARGET_PATH:-"/etc/nginx/sites-available/default"}

"${SCRIPT_DIR}/generate-nginx.sh" "${OUTPUT_PATH}"

sudo cp "${OUTPUT_PATH}" "${TARGET_PATH}"
sudo nginx -t
sudo systemctl reload nginx

echo "Deployed nginx config to ${TARGET_PATH}"
