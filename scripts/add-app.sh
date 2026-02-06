#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ROOT_DIR=$(cd "${SCRIPT_DIR}/.." && pwd)
ENV_FILE="${ROOT_DIR}/.env"

usage() {
  echo "Usage: $0 <slug> <port>"
  echo ""
  echo "Add a Vite app to the workspace and redeploy nginx."
  echo ""
  echo "Examples:"
  echo "  $0 my-app 5177"
  echo "  $0 dashboard 5178"
  exit 1
}

[ $# -ge 2 ] || usage

SLUG="$1"
PORT="$2"

# Validate
if ! echo "$PORT" | grep -qE '^[0-9]+$'; then
  echo "✗ Port must be a number: $PORT" >&2
  exit 1
fi

if ! echo "$SLUG" | grep -qE '^[a-z0-9][a-z0-9-]*$'; then
  echo "✗ Slug must be lowercase alphanumeric with hyphens: $SLUG" >&2
  exit 1
fi

if [ ! -f "$ENV_FILE" ]; then
  echo "✗ No .env found — run init.sh first" >&2
  exit 1
fi

# Load current env
set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

VITE_APPS=${VITE_APPS:-""}

# Check for duplicate slug or port
for app in $VITE_APPS; do
  existing_slug=${app%%:*}
  existing_port=${app##*:}
  if [ "$existing_slug" = "$SLUG" ]; then
    echo "✗ Slug '${SLUG}' already exists (port ${existing_port})" >&2
    exit 1
  fi
  if [ "$existing_port" = "$PORT" ]; then
    echo "✗ Port ${PORT} already used by '${existing_slug}'" >&2
    exit 1
  fi
done

# Append to VITE_APPS
if [ -n "$VITE_APPS" ]; then
  NEW_VITE_APPS="${VITE_APPS} ${SLUG}:${PORT}"
else
  NEW_VITE_APPS="${SLUG}:${PORT}"
fi

# Update .env
if grep -q '^VITE_APPS=' "$ENV_FILE"; then
  sed -i "s|^VITE_APPS=.*|VITE_APPS=\"${NEW_VITE_APPS}\"|" "$ENV_FILE"
else
  echo "VITE_APPS=\"${NEW_VITE_APPS}\"" >> "$ENV_FILE"
fi

echo "✓ Added ${SLUG}:${PORT} to VITE_APPS"

# Redeploy nginx + workspace shell
export VITE_APPS="$NEW_VITE_APPS"
"${SCRIPT_DIR}/deploy-nginx.sh"
echo "✓ Nginx redeployed with new app"

"${SCRIPT_DIR}/deploy-workspace-shell.sh"
echo "✓ Workspace shell updated with new app"

echo ""
echo "Next steps:"
echo "  1. Create or clone the app at ~/$(echo "$SLUG" | tr '-' '-')"
echo "  2. Configure vite.config.ts:"
echo "       base: '/${SLUG}/'"
echo "       server.hmr.path: '/${SLUG}/__vite_hmr'"
echo "       server.port: ${PORT}"
echo "  3. Start the dev server:"
echo "       cd ~/${SLUG} && bun run dev --host 0.0.0.0 --port ${PORT}"
echo "  4. Visit: https://\${DOMAIN:-judigot.com}/${SLUG}/"
