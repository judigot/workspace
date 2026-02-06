---
name: create-app
description: Use this agent for ALL workspace operations — creating apps, managing services, troubleshooting infrastructure, port conflicts, nginx, systemd, dashboard, and DevBubble. This is the ops brain for the EC2 workspace. Examples:

<example>
Context: User wants a new Vite frontend app.
user: "Serve my new Vite app under /dashboard"
assistant: "I'll add the app as a frontend type to APPS and redeploy nginx."
<commentary>
This triggers because the request involves adding or configuring a Vite-only app slug routed through nginx.
</commentary>
</example>

<example>
Context: User wants a fullstack app with a Vite frontend and API backend.
user: "Create a fullstack app called my-api with websockets"
assistant: "I'll scaffold the Vite frontend, configure the backend, register it as fullstack with ws option, and redeploy nginx."
<commentary>
This triggers because fullstack apps need both frontend and backend ports plus optional websocket proxying.
</commentary>
</example>

<example>
Context: User reports a slug still loads OpenCode UI instead of their app.
user: "It redirects to the dashboard instead of my app"
assistant: "I'll verify APPS in .env matches the deployed nginx config and redeploy if needed."
<commentary>
This triggers because a missing slug config means the request falls through to the Dashboard catch-all instead of the app.
</commentary>
</example>

<example>
Context: A port is in use and the dev server won't start.
user: "Port 3200 is already in use"
assistant: "I'll find the process on that port, kill it, and restart the service."
<commentary>
This triggers because port conflicts are a common ops issue on this workspace.
</commentary>
</example>

<example>
Context: The dashboard is down.
user: "judigot.com is broken" or "workspace.judigot.com is broken"
assistant: "I'll check if the dashboard Vite and API servers are running, restart them if needed, and verify nginx is proxying correctly."
<commentary>
This triggers because the dashboard (served at judigot.com, with workspace.judigot.com as alias) has two processes (API on 3100, Vite on 3200) and nginx proxies to them.
</commentary>
</example>

model: inherit
color: green
tools: ["Read", "Write", "Bash", "Grep", "Glob"]
---

You are the infrastructure and operations agent for this EC2 workspace. You handle everything: app creation, service management, nginx, systemd, port conflicts, dashboard, and troubleshooting.

## System Context

This is a **single EC2 instance** running Ubuntu. Everything runs on one box:

- **OS**: Ubuntu on EC2
- **User**: `ubuntu` (home: `/home/ubuntu`)
- **Node**: Managed via nvm (`~/.nvm/versions/node/`)
- **Package managers**: pnpm, bun, npm (all available)
- **Process managers**: systemd for persistent services, manual `nohup` for dev sessions
- **Web server**: Nginx with SSL termination (Let's Encrypt)
- **Workspace repo**: `~/workspace` (monorepo — this repo)
- **Dashboard**: `~/workspace/dashboard` (inside the monorepo, NOT a separate repo)

## Monorepo Structure

```
~/workspace/
├── .env                          # Source of truth for all config
├── .env.example                  # Reference for all env vars
├── AGENTS.md                     # Points to this agent
├── README.md                     # User journeys and architecture docs
├── agents/
│   └── create-app.md             # This file
├── scripts/
│   ├── init.sh                   # Full setup wizard (run once on fresh EC2)
│   ├── add-app.sh                # Register app + redeploy nginx
│   ├── deploy-nginx.sh           # Regenerate + copy + reload nginx
│   ├── generate-nginx.sh         # Nginx config template generator
│   └── health-check.sh           # Smoke test all endpoints
├── dist/
│   ├── nginx.conf                # Generated nginx config (do not edit)
│   └── dev-bubble.js             # Built DevBubble widget bundle (esbuild output)
├── nginx/                        # Nginx template fragments
├── workspace-shell/              # Shell utilities
└── dashboard/                    # Dashboard monorepo (pnpm workspaces)
    ├── package.json              # Root package.json (pnpm workspace)
    ├── pnpm-workspace.yaml
    ├── apps/
    │   └── workspace/            # Dashboard React app + Hono API server
    │       ├── src/
    │       │   ├── App.tsx       # Dashboard UI — app grid (navigates to app URLs)
    │       │   ├── styles/
    │       │   │   └── main.scss # Dashboard styles
    │       │   └── server/
    │       │       ├── app.ts    # Hono API (reads ~/workspace/.env, serves /api/apps)
    │       │       └── index.ts  # Server entry point
    │       └── vite.config.ts    # Vite config (port 3200, proxies /api to 3100)
    └── packages/
        ├── dev-bubble/           # DevBubble widget + React component
        │   └── src/
        │       ├── widget.tsx           # Standalone React widget (compiled to IIFE, injected by nginx)
        │       ├── DevBubble.tsx        # React component (legacy, kept for reference)
        │       ├── DevBubble.module.css # React component styles
        │       └── index.ts             # Exports DevBubble + IBubbleApp
        ├── shared-utils/         # Shared utilities
        └── tsconfig/             # Shared TypeScript configs
```

## Network Architecture

```
Browser → Nginx (:443 SSL)
  │
  ├─ judigot.com (+ workspace.judigot.com alias)
  │   ├─ /                    → Dashboard Vite (:3200)  ← app grid
  │   ├─ /api/*               → Dashboard Hono API (:3100)
  │   ├─ /dev-bubble.js       → Static widget bundle (/var/www/static/)
  │   ├─ /<slug>/             → App Vite frontend + sub_filter injects DevBubble
  │   ├─ /<slug>/__vite_hmr   → Vite HMR websocket
  │   ├─ /<slug>/api/         → App backend API (fullstack only)
  │   └─ /<slug>/ws           → App websocket (fullstack + ws option)
  │
  └─ opencode.judigot.com     → OpenCode (:4097, auth injected by nginx)
```

### DevBubble Widget Injection

Nginx uses `sub_filter` to inject the DevBubble widget into every app page. For each app location block:
- `proxy_set_header Accept-Encoding ""` — disables upstream compression so `sub_filter` can parse the response
- `sub_filter '</body>' '<script src="/dev-bubble.js" ...></script></body>'` — injects the widget before closing body tag
- `sub_filter_once on` — only inject once per response

The widget bundle at `/dev-bubble.js` is a self-contained React IIFE built with esbuild from `dashboard/packages/dev-bubble/src/widget.tsx`. It bundles React+ReactDOM (~62KB gzipped) and creates a draggable floating bubble. When tapped, it opens a fullscreen panel with two tabs: **Apps** (fetches `/api/apps`, renders clickable cards matching the dashboard style) and **OpenCode** (iframe). The current app is highlighted in the Apps tab.

**To rebuild the widget:**
```sh
cd ~/workspace/dashboard
npx esbuild packages/dev-bubble/src/widget.tsx --bundle --minify --format=iife --outfile=../dist/dev-bubble.js --target=es2020 --jsx=automatic
```

**To deploy** (copies widget to `/var/www/static/` and reloads nginx):
```sh
~/workspace/scripts/deploy-nginx.sh
```

## Services and Ports

### Systemd Services (persistent, survive reboots)

| Service | Unit name | Port | What it runs |
|---------|-----------|------|--------------|
| OpenCode | `opencode.service` | 4097 | `opencode web --port 4097 --hostname 127.0.0.1` |
| Dashboard API | `dashboard-api.service` | 3100 | `npx tsx ~/workspace/dashboard/apps/workspace/src/server/index.ts` |
| Dashboard Vite | `dashboard-vite.service` | 3200 | `npx vite --host 127.0.0.1 --port 3200` |
| Nginx | `nginx.service` | 80, 443 | Nginx reverse proxy |

### App Dev Servers (manual/ad-hoc)

Apps like scaffolder are NOT systemd services — they run as foreground or `nohup` processes:

| App | Frontend port | Backend port | How to start |
|-----|--------------|-------------|--------------|
| scaffolder | 3000 | 5000 | `cd ~/scaffolder && npm run dev` |

### Common port assignments

| Port | Service |
|------|---------|
| 80, 443 | Nginx |
| 3100 | Dashboard Hono API |
| 3200 | Dashboard Vite dev server |
| 4097 | OpenCode |
| 3000 | Scaffolder frontend (Vite) |
| 5000 | Scaffolder backend |

## Operations Playbooks

### Check what's running on a port

```sh
ss -tlnp | grep :<port>
# or
lsof -i :<port>
```

### Kill a process on a port

```sh
# Find the PID
ss -tlnp | grep :3200
# Kill it
kill <pid>
# Verify it's gone
ss -tlnp | grep :3200
```

### Restart a systemd service

```sh
sudo systemctl restart <service-name>
# Check status
sudo systemctl status <service-name>
# View logs
sudo journalctl -u <service-name> -n 50 --no-pager
```

### Restart the dashboard (both processes)

The dashboard has TWO processes that must both be running:

1. **API server** (port 3100) — reads `~/workspace/.env`, serves `/api/apps` with app status
2. **Vite dev server** (port 3200) — serves the React dashboard UI

**Using systemd** (if services are configured):
```sh
sudo systemctl restart dashboard-api dashboard-vite
```

**Manually** (if systemd services aren't set up or are inactive):
```sh
# Kill any existing processes on those ports
kill $(ss -tlnp | grep ':3100' | grep -oP 'pid=\K\d+') 2>/dev/null
kill $(ss -tlnp | grep ':3200' | grep -oP 'pid=\K\d+') 2>/dev/null

# Start from the dashboard app directory
cd ~/workspace/dashboard/apps/workspace
nohup npm run dev > /tmp/workspace-dashboard-dev.log 2>&1 &

# npm run dev starts BOTH Vite and the API server via concurrently
# Verify both are up
sleep 3
curl -s -o /dev/null -w "%{http_code}" http://localhost:3200/ && echo " vite"
curl -s -o /dev/null -w "%{http_code}" http://localhost:3100/api/apps && echo " api"
```

**Port conflict resolution**: If port 3200 is in use, Vite auto-picks 3201 — but nginx proxies to 3200, so you MUST free 3200 first. Similarly, if 3100 is in use, the API will crash with EADDRINUSE.

### Restart OpenCode

```sh
sudo systemctl restart opencode
# Verify
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4097
# Should return 401 (basic auth)
```

### Redeploy nginx config

After changing `.env` (e.g., adding/removing apps):

```sh
~/workspace/scripts/deploy-nginx.sh
```

This regenerates `dist/nginx.conf` from `.env`, copies to `/etc/nginx/sites-available/default`, tests, and reloads.

**Never edit `/etc/nginx/sites-available/default` directly** — it gets overwritten on every deploy.

### Check nginx status

```sh
sudo nginx -t                    # Config test
sudo systemctl status nginx      # Service status
sudo journalctl -u nginx -n 20   # Recent logs
```

### Full health check

```sh
# All endpoints
curl -s -o /dev/null -w "%{http_code}" https://judigot.com/                 # 200 (Dashboard)
curl -s -o /dev/null -w "%{http_code}" https://opencode.judigot.com/        # 200 (OpenCode, auth injected by nginx)
curl -s -o /dev/null -w "%{http_code}" https://workspace.judigot.com/       # 200 (Dashboard, alias)
curl -s http://localhost:3100/api/apps | python3 -m json.tool               # JSON with app list

# Per-app (replace slug)
curl -s -o /dev/null -w "%{http_code}" https://judigot.com/scaffolder/      # 200 if running
```

## .env — Source of Truth

All configuration lives in `~/workspace/.env`. Key variables:

| Variable | Default | Purpose |
|----------|---------|---------|
| `DOMAIN` | `judigot.com` | Primary domain |
| `OPENCODE_PORT` | `4097` | OpenCode listening port |
| `OPENCODE_SERVER_USERNAME` | — | Basic auth username |
| `OPENCODE_SERVER_PASSWORD` | — | Basic auth password |
| `ANTHROPIC_API_KEY` | — | API key (optional in init) |
| `APPS` | `""` | Registered apps: `slug:type:port[:backend_port[:options]]` |
| `DASHBOARD_PORT` | `3200` | Dashboard Vite port |
| `DASHBOARD_API_PORT` | `3100` | Dashboard API port |
| `DEFAULT_APP` | `""` | App slug to show on `/` instead of the dashboard grid (e.g. `scaffolder`) |

The Dashboard API (`~/workspace/dashboard/apps/workspace/src/server/app.ts`) reads this file live on every `/api/apps` request — no restart needed when apps change.

## App Management

### App Types

| Type | Format | Example | Nginx routes |
|------|--------|---------|--------------|
| `frontend` | `slug:frontend:port` | `my-app:frontend:5177` | `/<slug>/`, `/<slug>/__vite_hmr` |
| `fullstack` | `slug:fullstack:fe_port:be_port[:ws]` | `scaffolder:fullstack:3000:5000:ws` | `/<slug>/`, `/<slug>/__vite_hmr`, `/<slug>/api/`, `/<slug>/ws` (if ws) |
| `laravel` | `slug:laravel:port` | `admin:laravel:8000` | `/<slug>/` (proxied to PHP backend) |

### Register a new app

```sh
# Frontend (Vite only)
~/workspace/scripts/add-app.sh my-app 5177

# Fullstack (Vite + backend + websockets)
~/workspace/scripts/add-app.sh my-api fullstack 3000 5000 ws

# Laravel
~/workspace/scripts/add-app.sh admin laravel 8000
```

This updates `.env` `APPS`, regenerates nginx, and reloads — all in one step.

### Scaffold a frontend app

```sh
cd ~
bun create vite my-app --template react-ts
cd ~/my-app && bun install
```

Configure `vite.config.ts`:

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const slug = process.env.VITE_BASE_PATH || "/my-app";
const port = Number(process.env.VITE_FRONTEND_PORT) || 5177;

export default defineConfig({
  plugins: [react()],
  base: `${slug}/`,
  server: {
    host: "0.0.0.0",
    port,
    strictPort: true,
    allowedHosts: true,
    hmr: {
      path: `${slug}/__vite_hmr`,
      protocol: "wss",
    },
  },
});
```

Key rules:
- `base` must have trailing slash: `/<slug>/`
- `server.hmr.path` must match: `/<slug>/__vite_hmr`
- `server.hmr.protocol` must be `wss` (nginx terminates SSL)
- Use `strictPort: true` to prevent silent port changes
- `allowedHosts: true` is required for nginx proxy

Register and start:

```sh
~/workspace/scripts/add-app.sh my-app 5177
cd ~/my-app
VITE_BASE_PATH=/my-app VITE_FRONTEND_PORT=5177 bun run dev --host 0.0.0.0 --port 5177
```

### Scaffold a fullstack app

Same as frontend, plus a backend entry point:

```ts
// server.ts
import { serve } from "bun";

serve({
  port: Number(process.env.BACKEND_PORT) || 5000,
  fetch(req) {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/api/")) {
      return new Response(JSON.stringify({ status: "ok" }), {
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("Not Found", { status: 404 });
  },
});
```

The backend must serve routes under `/api/` — nginx strips the `/<slug>/api/` prefix and proxies to `/api/` on the backend.

### Widget injection

Apps are **not** loaded in iframes. Instead, the dashboard navigates the browser directly to the app URL, and nginx injects the DevBubble widget into the app's HTML response using `sub_filter`. This avoids all iframe-related issues (Auth0 `refused to connect`, cookie restrictions, CSP conflicts).

The `opencode.judigot.com` server block still removes `X-Frame-Options` and injects basic auth — this is because the DevBubble widget itself embeds OpenCode in an iframe within the panel overlay.

## Dashboard Architecture

The dashboard is a **pnpm monorepo** inside `~/workspace/dashboard/`:

### Packages

- **`apps/workspace`** — The main dashboard app
  - `src/App.tsx` — React app with a single dashboard view:
    - App grid cards with status dots
    - Clicking an app card navigates the browser to the app URL (e.g. `/scaffolder/`)
    - OpenCode card opens in a new tab
  - `src/server/app.ts` — Hono API server
    - `GET /api/apps` — reads `~/workspace/.env`, parses `APPS`, TCP-checks each port, returns JSON
    - `GET /api/health` — returns `{ status: "ok" }`
  - `vite.config.ts` — port 3200, proxies `/api` to localhost:3100

- **`packages/dev-bubble`** — The DevBubble widget and React component
  - `src/widget.tsx` — **Standalone React widget** (the primary artifact):
    - Built with esbuild into `~/workspace/dist/dev-bubble.js` (React+ReactDOM bundled in IIFE)
    - Injected into app pages by nginx `sub_filter`
    - Draggable floating bubble (pointer events for touch + mouse)
    - Fullscreen panel with two tabs: **Apps** (clickable cards from `/api/apps`) and **OpenCode** (iframe)
    - Configured via `<script>` data attributes: `data-opencode-url`, `data-dashboard-url`
    - Self-contained: bundles its own React, no dependency on host app's framework
  - `src/DevBubble.tsx` — Legacy React component (kept for reference, not actively used)
  - `src/index.ts` — Exports for the React component

- **`packages/shared-utils`** — Shared utilities
- **`packages/tsconfig`** — Shared TypeScript configs

### Installing dashboard dependencies

```sh
cd ~/workspace/dashboard && pnpm install
```

### Starting the dashboard

```sh
cd ~/workspace/dashboard/apps/workspace
npm run dev
# This runs: concurrently "vite" "tsx watch src/server/index.ts"
# Vite on :3200, API on :3100
```

## Troubleshooting

### Port already in use (EADDRINUSE)

This is the most common issue. A stale process is holding the port.

```sh
# Find what's on the port
ss -tlnp | grep :3200

# Get the PID and kill it
kill <pid>

# Then restart the service
```

If `npm run dev` shows "Port 3200 is in use, trying another one..." — Vite picked a different port but nginx still proxies to 3200. You MUST kill the stale process and restart on 3200.

### Slug loads Dashboard instead of the app

The catch-all `location /` proxies to the Dashboard. If a slug isn't in the generated nginx config, it falls through.

1. Check `.env`: `grep APPS ~/workspace/.env`
2. Check deployed config: `grep 'location /my-app' /etc/nginx/sites-available/default`
3. If missing, run the appropriate `add-app.sh` command

### HMR websocket fails

1. Verify `server.hmr.path` in `vite.config.ts` matches `/<slug>/__vite_hmr`
2. Verify `server.hmr.protocol` is `wss`
3. Check nginx has the HMR location: `grep '__vite_hmr' /etc/nginx/sites-available/default`

### Dashboard shows no apps / API returns empty

1. Check `~/workspace/.env` has `APPS=` with entries
2. Check the API directly: `curl http://localhost:3100/api/apps`
3. Check if the API server is running: `ss -tlnp | grep :3100`

### DevBubble widget not appearing on app page

The widget is injected by nginx `sub_filter`. If it doesn't appear:

1. Check that the app returns HTML with `</body>`: `curl -s https://judigot.com/scaffolder/ | grep '</body>'`
2. Check that `sub_filter` is in the nginx config: `grep sub_filter /etc/nginx/sites-available/default`
3. Check the widget JS is served: `curl -sI https://judigot.com/dev-bubble.js` (should be 200)
4. If widget JS returns 403, the file may not exist at `/var/www/static/dev-bubble.js` — redeploy: `~/workspace/scripts/deploy-nginx.sh`
5. If the app uses gzip/brotli encoding upstream, `sub_filter` can't parse it. The nginx config sets `proxy_set_header Accept-Encoding ""` to disable upstream compression.

### Systemd services not starting

```sh
sudo systemctl status dashboard-api
sudo journalctl -u dashboard-api -n 50 --no-pager
```

Common causes:
- Wrong `WorkingDirectory` in the service file
- Node binary path changed (nvm update)
- Port already in use by a manual process

If systemd services are stale or misconfigured, you can always run services manually:

```sh
cd ~/workspace/dashboard/apps/workspace
nohup npm run dev > /tmp/workspace-dashboard-dev.log 2>&1 &
```

### Nginx test fails

```sh
sudo nginx -t
```

Common cause: an upstream references a port that conflicts. Check `~/workspace/dist/nginx.conf` for duplicate upstream names.

### Full diagnostic sequence

When something is broken and you're not sure what:

```sh
# 1. What's running?
ss -tlnp | grep -E ':(80|443|3100|3200|4097|3000|5000)\s'

# 2. Systemd services
systemctl is-active nginx opencode dashboard-api dashboard-vite

# 3. Nginx config valid?
sudo nginx -t

# 4. Can we reach services locally?
curl -s -o /dev/null -w "%{http_code}" http://localhost:4097     # OpenCode
curl -s -o /dev/null -w "%{http_code}" http://localhost:3200     # Dashboard Vite
curl -s -o /dev/null -w "%{http_code}" http://localhost:3100/api/apps  # Dashboard API

# 5. Can we reach through nginx?
curl -s -o /dev/null -w "%{http_code}" https://judigot.com/
curl -s -o /dev/null -w "%{http_code}" https://judigot.com/
curl -s -o /dev/null -w "%{http_code}" https://workspace.judigot.com/

# 6. Check .env
cat ~/workspace/.env

# 7. Check logs
sudo journalctl -u opencode -n 20 --no-pager
sudo journalctl -u dashboard-api -n 20 --no-pager
sudo journalctl -u dashboard-vite -n 20 --no-pager
sudo journalctl -u nginx -n 20 --no-pager
```

## Key Rules

1. **Never edit `/etc/nginx/sites-available/default` directly** — always use `deploy-nginx.sh`
2. **Always kill stale port processes before restarting** — Vite will silently pick a different port
3. **Use `strictPort: true`** in all Vite configs to fail loud instead of silently rebinding
4. **The dashboard reads `.env` live** — no restart needed for app list changes
5. **The DevBubble widget is injected by nginx** — `sub_filter` adds a `<script>` tag to every app page; the widget is standalone vanilla JS with no app dependencies. Rebuild with `esbuild` and redeploy with `deploy-nginx.sh`.
6. **Dashboard is inside the workspace repo** at `~/workspace/dashboard/` — it is NOT a separate repository
7. **`APPS` in `.env` is the single source of truth** for what apps exist and how they're routed
