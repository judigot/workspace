# Workspace

Mobile-first development workspace. Vibe code from your phone — open your app, tap the chat bubble, tell the AI what to change, see it live.

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

**Step 2 — Clone and run init**

```sh
git clone git@github.com:judigot/workspace.git ~/workspace
cd ~/workspace
./scripts/init.sh
```

The wizard prompts for:
- Domain (default: `judigot.com`)
- OpenCode username and password (basic auth)
- Anthropic API key (optional — skip if already configured)

Then it automatically:
1. Installs opencode (via `installOpenCode` from `.devrc`)
2. Issues TLS certificates (`certbot --standalone`)
3. Generates and deploys the nginx config with SSL
4. Creates and starts the `opencode.service` systemd unit
5. Installs dashboard deps and starts the dashboard services

**Step 3 — Open the browser**

| URL | What you see |
|-----|-------------|
| `https://judigot.com` | Dashboard — app grid with live status |
| `https://opencode.judigot.com` | OpenCode (embeddable, used by the chat bubble) |
| `https://workspace.judigot.com` | Dashboard (alias for `judigot.com`) |

---

### Journey 2: Create an App via OpenCode

Open OpenCode at `opencode.judigot.com` (or from the chat bubble inside any app). Ask it to create an app.

> "Create a new React app called my-app"

OpenCode (via the `create-app` agent) will:
1. Scaffold `~/my-app` with Vite + React + TypeScript
2. Configure `vite.config.ts` with the correct base path, HMR, and port
3. Run `~/workspace/scripts/add-app.sh my-app frontend 5177`
4. Start the dev server

Result:
- `https://judigot.com/my-app/` is live
- Dashboard at `judigot.com` shows it with a green status dot
- Tap the card to open it full-screen with the chat bubble

Full-stack apps work too:

> "Create a full-stack app called my-api with a Hono backend"

```sh
# What the agent runs:
~/workspace/scripts/add-app.sh my-api fullstack 3000 5000 ws
```

---

### Journey 3: Vibe Code from Your Phone

This is the core workflow. You're on your phone, looking at your app.

```
┌─────────────────────────┐
│      judigot.com        │
│                         │
│  ┌──────┐  ┌─────────┐ │
│  │  OC  │  │scaffolder│ │
│  │  ●   │  │  ●      │ │
│  └──────┘  └─────────┘ │
│                         │
└─────────────────────────┘
```

**Step 1** — Tap the scaffolder card. Your app loads full-screen.

```
┌─────────────────────────┐
│                         │
│                         │
│     Your app fills      │
│     the entire screen   │
│                         │
│                         │
│                  🟣      │
│                  bubble  │
└─────────────────────────┘
```

**Step 2** — You see something you want to change. Tap the chat bubble (bottom-right). OpenCode opens fullscreen.

**Step 3** — Tell it what you want:

> "Change the header background to red"

OpenCode edits the code. Vite HMR picks up the change. **You see it instantly.**

**Step 4** — Tap minimize. You're back to your app with the change applied. Keep going.

This is the loop:

```
Look at app → Tap bubble → Tell AI what to change → See it live → Repeat
```

No editor. No terminal. No laptop. Just your phone and the running app.

---

### Journey 4: Open an Existing App

Go to `judigot.com`. The dashboard shows all registered apps with live status:

- **Green dot** = dev server is running
- **Gray dot** = dev server is stopped
- **OC card** = opens OpenCode in a new tab

Tap any app card to view it full-screen. The **DevBubble** appears (bottom-right, draggable):
- Tap to expand — opens a panel with workspace nav (Home + app tabs) above the OpenCode iframe
- Tap Home in the nav — returns to dashboard
- Tap an app tab — switches to that app
- Tap minimize — collapse back to bubble (OpenCode session is preserved)

The bubble is draggable like a Messenger chat head. It is the **only control surface** in app view — no top nav bar, no standalone back button.

---

### Journey 5: Add an App Manually

```sh
# Frontend only (Vite)
~/workspace/scripts/add-app.sh my-app 5177

# Full-stack (Vite frontend + API backend + websockets)
~/workspace/scripts/add-app.sh my-api fullstack 3000 5000 ws

# Laravel
~/workspace/scripts/add-app.sh admin laravel 8000
```

The dashboard picks up new apps automatically (reads `.env` live).

---

### Journey 6: Re-run init (Idempotent)

```sh
cd ~/workspace && ./scripts/init.sh
```

Reads `.env` for defaults. Skips certs if they already cover all domains. Restarts services cleanly.

---

## Architecture

```
judigot.com (+ workspace.judigot.com alias)
        │
        ▼
   Nginx (:443, SSL)
        │
        ├─ /              → Dashboard Vite (:3200)  ← app grid + DevBubble
        ├─ /api/*         → Dashboard Hono API (:3100)
        │                   reads .env, checks port health
        ├─ /<slug>/       → App Vite frontend (frontend/fullstack)
        ├─ /<slug>/api/   → App backend API (fullstack only)
        ├─ /<slug>/ws     → App websocket (fullstack+ws)
        └─ /<slug>/       → App backend (laravel)

opencode.judigot.com → OpenCode (:4097, iframe-friendly, auth injected by nginx)
```

**The DevBubble loop:**

```
Phone → judigot.com → tap app → full-screen iframe
                                              │
                                    tap bubble → OpenCode (fullscreen)
                                              │
                                    "change X" → AI edits code
                                              │
                                    Vite HMR → change visible instantly
                                              │
                                    minimize → back to app
```

## App Types

| Type | Command | Nginx routes generated |
|------|---------|----------------------|
| `frontend` | `add-app.sh my-app 5177` | `/<slug>/` → Vite, `/<slug>/__vite_hmr` → HMR |
| `fullstack` | `add-app.sh my-api fullstack 3000 5000 ws` | Above + `/<slug>/api/` → backend, `/<slug>/ws` → websocket |
| `laravel` | `add-app.sh admin laravel 8000` | `/<slug>/` → PHP backend |

## Repos

| Directory | Purpose |
|-----------|---------|
| `~/workspace` | Monorepo root — nginx config, init wizard, scripts, agents |
| `~/workspace/dashboard` | Dashboard React app + Hono API + DevBubble package |

## Scripts

| Script | Purpose |
|--------|---------|
| `scripts/init.sh` | Full setup wizard — run once after clone |
| `scripts/add-app.sh` | Register a new app (frontend/fullstack/laravel) and redeploy nginx |
| `scripts/deploy-nginx.sh` | Regenerate + deploy nginx config from `.env` |
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
| `ANTHROPIC_API_KEY` | — | API key for OpenCode (optional in init) |
| `APPS` | `""` | Registered apps (`slug:type:port[:backend_port[:options]]`) |
| `DASHBOARD_PORT` | `3200` | Dashboard Vite dev server port |
| `DASHBOARD_API_PORT` | `3100` | Dashboard Hono API port |
| `DEFAULT_APP` | `""` | App slug to show on `/` instead of the dashboard grid (e.g. `scaffolder`) |
