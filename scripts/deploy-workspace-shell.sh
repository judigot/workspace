#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ROOT_DIR=$(cd "${SCRIPT_DIR}/.." && pwd)

SOURCE_HTML=${SOURCE_HTML:-"${ROOT_DIR}/workspace-shell/index.html"}
TARGET_ROOT=${TARGET_ROOT:-"/var/www/workspace"}

sudo mkdir -p "${TARGET_ROOT}"
sudo cp "${SOURCE_HTML}" "${TARGET_ROOT}/index.html"

echo "Deployed workspace shell to ${TARGET_ROOT}/index.html"
