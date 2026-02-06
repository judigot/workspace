#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ROOT_DIR=$(cd "${SCRIPT_DIR}/.." && pwd)
ENV_FILE="${ROOT_DIR}/.env"

usage() {
  cat <<'EOF'
Usage:
  add-app.sh <slug> <type> <frontend_port> [backend_port] [options]
  add-app.sh <slug> <port>                    (shorthand for frontend)

Types:
  frontend   — Vite frontend only (slug + frontend_port)
  fullstack  — Vite frontend + backend (slug + frontend_port + backend_port)
                Options: ws (enable websocket proxying)
  nextjs     — Next.js app (slug + port). HMR via /_next/webpack-hmr
  nuxt       — Nuxt app (slug + port). HMR via /_nuxt/
  laravel    — Laravel backend only (slug + backend_port)
  backend    — Any backend server (Spring Boot, Django, Express, etc.)
  static     — Any dev server with no special HMR needs

Examples:
  add-app.sh my-app 5177
  add-app.sh my-app frontend 5177
  add-app.sh scaffolder fullstack 3000 5000 ws
  add-app.sh admin laravel 8000
  add-app.sh blog nextjs 3001
  add-app.sh docs nuxt 3002
  add-app.sh api backend 8080
  add-app.sh landing static 4000

App entry format in .env APPS variable:
  slug:type:frontend_port[:backend_port[:options]]
EOF
  exit 1
}

main() {
  parse_args "$@"
  validate_inputs
  load_env
  migrate_legacy_apps
  check_conflicts
  build_entry
  update_env
  redeploy_nginx
  print_next_steps
}

parse_args() {
  [ $# -ge 2 ] || usage

  SLUG="$1"
  TYPE=""
  FRONTEND_PORT=""
  BACKEND_PORT=""
  OPTIONS=""

  # Shorthand: add-app.sh <slug> <port>
  if [ $# -eq 2 ] && echo "$2" | grep -qE '^[0-9]+$'; then
    TYPE="frontend"
    FRONTEND_PORT="$2"
    return
  fi

  TYPE="$2"

  case "$TYPE" in
    frontend)
      [ $# -ge 3 ] || { echo "frontend requires: slug frontend_port" >&2; usage; }
      FRONTEND_PORT="$3"
      ;;
    fullstack)
      [ $# -ge 4 ] || { echo "fullstack requires: slug frontend_port backend_port" >&2; usage; }
      FRONTEND_PORT="$3"
      BACKEND_PORT="$4"
      [ $# -ge 5 ] && OPTIONS="$5"
      ;;
    nextjs|nuxt|static)
      [ $# -ge 3 ] || { echo "${TYPE} requires: slug port" >&2; usage; }
      FRONTEND_PORT="$3"
      ;;
    laravel|backend)
      [ $# -ge 3 ] || { echo "${TYPE} requires: slug port" >&2; usage; }
      BACKEND_PORT="$3"
      ;;
    *)
      echo "Unknown type: ${TYPE}" >&2
      echo "Valid types: frontend, fullstack, nextjs, nuxt, laravel, backend, static" >&2
      exit 1
      ;;
  esac
}

validate_inputs() {
  if ! echo "$SLUG" | grep -qE '^[a-z0-9][a-z0-9-]*$'; then
    echo "Slug must be lowercase alphanumeric with hyphens: ${SLUG}" >&2
    exit 1
  fi

  if [ -n "$FRONTEND_PORT" ] && ! echo "$FRONTEND_PORT" | grep -qE '^[0-9]+$'; then
    echo "Frontend port must be a number: ${FRONTEND_PORT}" >&2
    exit 1
  fi

  if [ -n "$BACKEND_PORT" ] && ! echo "$BACKEND_PORT" | grep -qE '^[0-9]+$'; then
    echo "Backend port must be a number: ${BACKEND_PORT}" >&2
    exit 1
  fi

  if [ -n "$OPTIONS" ] && [ "$OPTIONS" != "ws" ]; then
    echo "Unknown option: ${OPTIONS} (valid: ws)" >&2
    exit 1
  fi

  if [ ! -f "$ENV_FILE" ]; then
    echo "No .env found — run init.sh first" >&2
    exit 1
  fi
}

load_env() {
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a

  APPS=${APPS:-""}
  VITE_APPS=${VITE_APPS:-""}
}

# Migrate legacy VITE_APPS (slug:port) to APPS (slug:frontend:port) format
migrate_legacy_apps() {
  if [ -n "$VITE_APPS" ] && [ -z "$APPS" ]; then
    local migrated=""
    for entry in $VITE_APPS; do
      local s=${entry%%:*}
      local p=${entry##*:}
      if [ -n "$migrated" ]; then
        migrated="${migrated} ${s}:frontend:${p}"
      else
        migrated="${s}:frontend:${p}"
      fi
    done
    APPS="$migrated"
    echo "Migrated VITE_APPS to APPS format: ${APPS}"
  fi
}

# Extract all ports from an app entry
entry_ports() {
  local entry="$1"
  # Format: slug:type:frontend_port[:backend_port[:options]]
  # or frontend shorthand: slug:frontend:port
  local IFS=':'
  # shellcheck disable=SC2086
  set -- $entry
  local t="${2:-}"
  case "$t" in
    frontend|nextjs|nuxt|static) echo "${3:-}" ;;
    fullstack) echo "${3:-}"; echo "${4:-}" ;;
    laravel|backend) echo "${3:-}" ;;
    # Legacy format (slug:port) — treat port as position 2
    *) [ -n "${2:-}" ] && echo "${2:-}" ;;
  esac
}

check_conflicts() {
  # Collect all ports for the new app
  local new_ports=""
  [ -n "$FRONTEND_PORT" ] && new_ports="$FRONTEND_PORT"
  [ -n "$BACKEND_PORT" ] && new_ports="${new_ports:+${new_ports} }${BACKEND_PORT}"

  for app in $APPS; do
    local existing_slug=${app%%:*}

    if [ "$existing_slug" = "$SLUG" ]; then
      echo "Slug '${SLUG}' already exists: ${app}" >&2
      exit 1
    fi

    for ep in $(entry_ports "$app"); do
      [ -z "$ep" ] && continue
      for np in $new_ports; do
        if [ "$ep" = "$np" ]; then
          echo "Port ${np} already used by '${existing_slug}'" >&2
          exit 1
        fi
      done
    done
  done
}

build_entry() {
  case "$TYPE" in
    frontend)
      APP_ENTRY="${SLUG}:frontend:${FRONTEND_PORT}"
      ;;
    fullstack)
      APP_ENTRY="${SLUG}:fullstack:${FRONTEND_PORT}:${BACKEND_PORT}"
      [ -n "$OPTIONS" ] && APP_ENTRY="${APP_ENTRY}:${OPTIONS}"
      ;;
    nextjs|nuxt|static)
      APP_ENTRY="${SLUG}:${TYPE}:${FRONTEND_PORT}"
      ;;
    laravel|backend)
      APP_ENTRY="${SLUG}:${TYPE}:${BACKEND_PORT}"
      ;;
  esac
}

update_env() {
  if [ -n "$APPS" ]; then
    NEW_APPS="${APPS} ${APP_ENTRY}"
  else
    NEW_APPS="${APP_ENTRY}"
  fi

  # Update or create APPS in .env
  if grep -q '^APPS=' "$ENV_FILE"; then
    sed -i "s|^APPS=.*|APPS=\"${NEW_APPS}\"|" "$ENV_FILE"
  else
    echo "APPS=\"${NEW_APPS}\"" >> "$ENV_FILE"
  fi

  # Keep VITE_APPS in sync for backward compatibility with generate-nginx.sh
  # VITE_APPS uses the legacy slug:port format (frontend port only)
  local vite_list=""
  for entry in $NEW_APPS; do
    local IFS=':'
    # shellcheck disable=SC2086
    set -- $entry
    local s="$1"
    local t="${2:-frontend}"
    case "$t" in
      frontend|fullstack|nextjs|nuxt|static) vite_list="${vite_list:+${vite_list} }${s}:${3}" ;;
      laravel|backend) vite_list="${vite_list:+${vite_list} }${s}:${3}" ;;
    esac
    IFS=' '
  done

  if grep -q '^VITE_APPS=' "$ENV_FILE"; then
    sed -i "s|^VITE_APPS=.*|VITE_APPS=\"${vite_list}\"|" "$ENV_FILE"
  else
    echo "VITE_APPS=\"${vite_list}\"" >> "$ENV_FILE"
  fi

  export APPS="$NEW_APPS"
  export VITE_APPS="$vite_list"

  echo "Added ${APP_ENTRY} to APPS"
}

redeploy_nginx() {
  "${SCRIPT_DIR}/deploy-nginx.sh"
  echo "Nginx redeployed"
}

print_next_steps() {
  local domain="\${DOMAIN:-judigot.com}"

  echo ""
  echo "Next steps for ${SLUG} (${TYPE}):"
  echo ""

  case "$TYPE" in
    frontend)
      cat <<EOF
  1. Create or clone the app at ~/${SLUG}
  2. Configure vite.config.ts:
       base: '/${SLUG}/'
       server.hmr.path: '/${SLUG}/__vite_hmr'
       server.port: ${FRONTEND_PORT}
  3. Start the dev server:
       cd ~/${SLUG} && bun run dev --host 0.0.0.0 --port ${FRONTEND_PORT}
  4. Visit: https://${domain}/${SLUG}/
EOF
      ;;
    fullstack)
      cat <<EOF
  1. Create or clone the app at ~/${SLUG}
  2. Configure vite.config.ts:
       base: '/${SLUG}/'
       server.hmr.path: '/${SLUG}/__vite_hmr'
       server.port: ${FRONTEND_PORT}
  3. Start the frontend:
       cd ~/${SLUG} && bun run dev --host 0.0.0.0 --port ${FRONTEND_PORT}
  4. Start the backend:
       cd ~/${SLUG} && bun run server --port ${BACKEND_PORT}
  5. Visit: https://${domain}/${SLUG}/
     API:   https://${domain}/${SLUG}/api/
EOF
      if [ "$OPTIONS" = "ws" ]; then
        echo "     WS:    wss://${domain}/${SLUG}/ws"
      fi
      ;;
    nextjs)
      cat <<EOF
  1. Create or clone the app at ~/${SLUG}
  2. Configure next.config.js (or .mjs/.ts):
       basePath: '/${SLUG}'
       assetPrefix: '/${SLUG}'
  3. Start the dev server:
       cd ~/${SLUG} && npx next dev --hostname 0.0.0.0 --port ${FRONTEND_PORT}
  4. Visit: https://${domain}/${SLUG}/
EOF
      ;;
    nuxt)
      cat <<EOF
  1. Create or clone the app at ~/${SLUG}
  2. Configure nuxt.config.ts:
       app: { baseURL: '/${SLUG}/' }
  3. Start the dev server:
       cd ~/${SLUG} && npx nuxt dev --host 0.0.0.0 --port ${FRONTEND_PORT}
  4. Visit: https://${domain}/${SLUG}/
EOF
      ;;
    laravel)
      cat <<EOF
  1. Create or clone the app at ~/${SLUG}
  2. Start the server (pick one):
       php artisan serve --host=0.0.0.0 --port=${BACKEND_PORT}
       php artisan octane:start --host=0.0.0.0 --port=${BACKEND_PORT}
  3. Visit: https://${domain}/${SLUG}/
EOF
      ;;
    backend)
      cat <<EOF
  1. Create or clone the app at ~/${SLUG}
  2. Start the server on port ${BACKEND_PORT} (bind to 0.0.0.0):
       Examples:
         Node/Bun:     cd ~/${SLUG} && bun run dev --port ${BACKEND_PORT}
         Spring Boot:  cd ~/${SLUG} && ./mvnw spring-boot:run -Dspring-boot.run.arguments=--server.port=${BACKEND_PORT}
         Django:       cd ~/${SLUG} && python manage.py runserver 0.0.0.0:${BACKEND_PORT}
         Flask:        cd ~/${SLUG} && flask run --host=0.0.0.0 --port=${BACKEND_PORT}
         Go:           cd ~/${SLUG} && go run . (listening on :${BACKEND_PORT})
  3. Visit: https://${domain}/${SLUG}/
EOF
      ;;
    static)
      cat <<EOF
  1. Create or clone the app at ~/${SLUG}
  2. Start the dev server on port ${FRONTEND_PORT} (bind to 0.0.0.0)
  3. Visit: https://${domain}/${SLUG}/
EOF
      ;;
  esac
}

main "$@"
