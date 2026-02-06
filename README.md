# Workspace

Nginx reverse proxy + OpenCode + dashboard for a fresh EC2 instance.

## User Journeys

### Journey 1: Initial Setup (Fresh EC2)

You just ran `terraform apply` and have an IP address.

**Step 1 — Bootstrap the system**

SSH into the instance and load the devrc toolchain:

```sh
. <(curl -fsSL "https://raw.githubusercontent.com/judigot/user/main/load-devrc.sh?cachebustkey=$(date +%s)")

initubuntu
installnodeenv
usessh
installAWS
useaws
installgithubcli
```

This installs nginx, certbot, node, bun, nvm, gh, and all system dependencies.

**Step 2 — Clone and run init**

```sh
git clone git@github.com:judigot/workspace.git ~/workspace
cd ~/workspace
./scripts/init.sh
```

The wizard prompts for:
- Domain (default: `judigot.com`)
- OpenCode username and password (basic auth)
- Anthropic API key

Then it automatically:
1. Installs opencode (via `installOpenCode` from `.devrc`)
2. Issues TLS certificates (`certbot --standalone` for all subdomains)
3. Generates and deploys the nginx config with SSL
4. Creates and starts the `opencode.service` systemd unit
5. Clones `judigot/dashboard`, installs deps, starts the dashboard API and Vite dev server as systemd services

**Step 3 — Open the browser**

| URL | What you see |
|-----|-------------|
| `https://judigot.com` | OpenCode web UI (basic auth prompt) |
| `https://opencode.judigot.com` | OpenCode (embeddable, used by the dashboard) |
| `https://workspace.judigot.com` | Dashboard — app grid with live status + draggable OpenCode chat bubble |

**Step 4 — Verify**

```sh
./scripts/health-check.sh
```

---

### Journey 2: Create a New App via OpenCode

You're in OpenCode (either at `judigot.com` or via the chat bubble on the dashboard). You ask it to create an app.

**What you say:**

> "Create a new React app called my-app"

**What OpenCode does** (via the `vite-nginx-playground` agent):

1. Scaffolds `~/my-app` with Vite + React + TypeScript
2. Configures `vite.config.ts` with the correct `base`, `hmr.path`, and `port`
3. Runs `~/workspace/scripts/add-app.sh my-app 5177`
   - Adds `my-app:5177` to `VITE_APPS` in `~/workspace/.env`
   - Regenerates and reloads the nginx config
   - Redeploys the dashboard (so the new app appears in the grid)
4. Starts the dev server

**Result:**

- `https://judigot.com/my-app/` serves the new app directly
- `https://workspace.judigot.com` shows it in the dashboard with a live status dot
- Click the app card to view it full-page with the OpenCode chat bubble

---

### Journey 3: Open an Existing App with the Chat Bubble

You go to `workspace.judigot.com` and see the dashboard:

```
┌──────────────────────────────────────────┐
│  Workspace                               │
│  judigot.com                             │
│                                          │
│  ┌──────┐  ┌──────────┐  ┌─────────┐   │
│  │  OC  │  │playground │  │ new-app │   │
│  │  ●   │  │  ●       │  │  ○      │   │
│  └──────┘  └──────────┘  └─────────┘   │
│                                          │
│                              🟣 DevBubble│
└──────────────────────────────────────────┘
  ● = running    ○ = stopped
```

- Click **playground** → full-page iframe of the app with a top bar (back button) and the draggable chat bubble
- Click **OC** → opens OpenCode in a new tab
- Click the **DevBubble** (purple circle, bottom-right) → fullscreen OpenCode overlay, drag it around like a Messenger bubble, tap to expand, minimize to shrink back

---

### Journey 4: Re-run init (Idempotent)

Something broke, or you changed your domain. Just re-run:

```sh
cd ~/workspace
./scripts/init.sh
```

It reads `.env` for existing values (shows them as defaults), skips cert issuance if certs already cover all domains, and restarts services cleanly.

---

### Journey 5: Add an App Manually (Without OpenCode)

```sh
# 1. Register the app with nginx
~/workspace/scripts/add-app.sh dashboard 5178

# 2. Create the Vite app
cd ~ && bun create vite dashboard --template react-ts

# 3. Configure vite.config.ts
#    base: "/dashboard/"
#    server.hmr.path: "/dashboard/__vite_hmr"
#    server.hmr.protocol: "wss"
#    server.port: 5178
#    server.strictPort: true

# 4. Start the dev server
cd ~/dashboard && bun run dev --host 0.0.0.0 --port 5178

# 5. Visit
open https://judigot.com/dashboard/
```

---

## Architecture

```
workspace.judigot.com                    judigot.com
        │                                     │
        ▼                                     ▼
   Nginx (:443, SSL)                     Nginx (:443, SSL)
        │                                     │
        ├─ /api/*  → Hono API (:3100)         ├─ /              → OpenCode (:4097)
        │            reads .env                ├─ /scaffolder/   → Vite (:3000)
        │            checks port health        ├─ /playground/   → Vite (:5175)
        │                                     ├─ /new-app/      → Vite (:5176)
        └─ /*      → Dashboard Vite (:3200)   └─ /<slug>/       → Vite (:<port>)
                     React app grid
                     DevBubble → opencode.judigot.com (iframe)

opencode.judigot.com → OpenCode (:4097, iframe-friendly CSP headers)
```

## Repos

| Repo | Purpose | Lives at |
|------|---------|----------|
| `judigot/workspace` | Nginx config, init wizard, scripts, agents | `~/workspace` |
| `judigot/dashboard` | Dashboard React app + Hono API + DevBubble package | `~/dashboard` |

## Scripts

| Script | Purpose |
|--------|---------|
| `scripts/init.sh` | Full setup wizard — run once after clone |
| `scripts/add-app.sh` | Add a new Vite app slug:port, redeploy nginx + dashboard |
| `scripts/deploy-nginx.sh` | Regenerate + deploy nginx config |
| `scripts/generate-nginx.sh` | Generate nginx.conf from env vars |
| `scripts/health-check.sh` | Smoke test all endpoints |

## Configuration

All config lives in `.env` (created by `init.sh`). See `.env.example` for reference.

| Variable | Default | Description |
|----------|---------|-------------|
| `DOMAIN` | `judigot.com` | Primary domain |
| `OPENCODE_PORT` | `4097` | OpenCode listening port |
| `OPENCODE_SERVER_USERNAME` | — | Basic auth username |
| `OPENCODE_SERVER_PASSWORD` | — | Basic auth password |
| `ANTHROPIC_API_KEY` | — | API key for OpenCode |
| `VITE_APPS` | `playground:5175 new-app:5176` | Vite apps (space-separated slug:port) |
| `DASHBOARD_PORT` | `3200` | Dashboard Vite dev server port |
| `DASHBOARD_API_PORT` | `3100` | Dashboard Hono API port |
| `API_BACKEND` | `127.0.0.1:5000` | Scaffolder API backend |
| `VITE_SCAFFOLDER_PORT` | `3000` | Scaffolder dev server port |
