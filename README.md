# Time Tracker for Coding

A self-hosted coding-time tracker in the spirit of WakaTime. A VS Code extension records the time you spend coding, the languages and projects you work in, and the commits you make. A small backend stores the data, and a minimalist dashboard (light and dark themes) shows it next to each developer's GitHub avatar, name and public commit count.

> **Local-first.** This project is currently designed to run **on a single machine for personal use**. Everything binds to `127.0.0.1`, there is no authentication, and the database uses default credentials. See [Scope: local today, global later](#scope-local-today-global-later) before you expose it to a network.

---

## Contents

- [Features](#features)
- [Architecture](#architecture)
- [Quick start (Docker)](#quick-start-docker)
- [Install the VS Code extension](#install-the-vs-code-extension)
- [Using the dashboard](#using-the-dashboard)
- [Local development without Docker](#local-development-without-docker)
- [Configuration reference](#configuration-reference)
- [API](#api)
- [How coding time is calculated](#how-coding-time-is-calculated)
- [Scope: local today, global later](#scope-local-today-global-later)
- [Troubleshooting](#troubleshooting)
- [Project structure](#project-structure)

---

## Features

**VS Code extension**
- Tracks active coding time per file, language and workspace, with idle detection (5 minutes by default).
- Records your commits automatically through VS Code's built-in Git extension. Branch switches, resets and pulled commits from other authors are ignored.
- Detects your GitHub username from the GitHub account signed in to VS Code, and your name from `git config user.name`. Both can be overridden in the settings.
- Works offline: every event is appended to `~/.time-tracker/events.jsonl`. Sending to the backend is optional.

**Dashboard**
- Minimalist blue-and-white design with a one-click dark theme. The choice is saved, and the page follows the system theme by default.
- Developer summary table: GitHub avatar and name, `@login` link, live status (coding now / away / offline), coding time, tracked commits, public GitHub commit count, top language, machine and last activity.
- KPI tiles, a daily activity chart with commit days marked, and language/project breakdowns, plus recent commits and raw activity.
- Range filter (Today / 7d / 30d / All) and per-developer filter: click a row in the table or use the selector.
- Refreshes automatically every 60 seconds. Responsive down to phone width.

**Backend**
- Fastify + Prisma + PostgreSQL, with OpenAPI docs at `/docs`.
- Aggregations run in SQL using your browser's time zone for day boundaries.
- A cached GitHub proxy (profile, avatar, commit count). An optional `GITHUB_TOKEN` raises the rate limits.

## Architecture

```
┌──────────────────────┐   POST /events    ┌──────────────────────┐      ┌──────────────┐
│ VS Code extension    │ ────────────────▶ │ Backend (Fastify)    │ ───▶ │ PostgreSQL   │
│ heartbeats, commits  │                   │ :3000                │      │ :5432        │
│ ~/.time-tracker/*.jsonl                  │ /stats /github /docs │      └──────────────┘
└──────────────────────┘                   └──────────▲───────────┘
                                                      │ /api/* (nginx proxy, same origin)
                                           ┌──────────┴───────────┐        api.github.com
                                           │ Dashboard (nginx)    │ ◀──── avatars, names,
                                           │ :8080                │        commit counts
                                           └──────────────────────┘
```

| Service    | Folder              | Default URL                    |
|------------|---------------------|--------------------------------|
| Dashboard  | `frontend/`         | http://localhost:8080          |
| Backend    | `app/`              | http://localhost:3000          |
| API docs   | `app/`              | http://localhost:3000/docs     |
| PostgreSQL | `docker-compose.yml`| `localhost:5432` (postgres/postgres) |
| Extension  | `vscode-extension/` | —                              |

## Quick start (Docker)

**Prerequisites:** [Docker Desktop](https://www.docker.com/products/docker-desktop/) (or Docker Engine with Compose v2), Git, and VS Code.

```bash
git clone <this repository> time_tracker_coding
cd time_tracker_coding
docker compose up -d --build
```

Open **http://localhost:8080**. The dashboard shows an onboarding card until the first events arrive. Next, [install the extension](#install-the-vs-code-extension).

### Busy ports?

If something else already uses 8080, 3000 or 5432, change the host ports. Use environment variables or a `.env` file next to `docker-compose.yml`:

```bash
# .env
FRONTEND_PORT=8088
BACKEND_PORT=3010
DB_PORT=5433
# optional, see "Configuration reference"
GITHUB_TOKEN=ghp_xxx
```

```bash
docker compose up -d --build
```

If you change `BACKEND_PORT`, remember to point the extension's `timeTracker.backendUrl` at the new port.

### Everyday commands

```bash
docker compose ps                  # status
docker compose logs -f backend     # backend logs
docker compose up -d --build       # rebuild after pulling changes
docker compose down                # stop (data is kept in the db_data volume)
docker compose down -v             # stop AND delete all tracked data
```

The database schema is applied automatically when the backend starts (`prisma db push`).

## Install the VS Code extension

### Option A: install the prebuilt `.vsix` (recommended)

A packaged build is committed at `vscode-extension/time-tracker-vscode-extension-0.2.0.vsix`.

**From the VS Code UI**
1. Open the Extensions view (`⇧⌘X` on macOS, `Ctrl+Shift+X` on Windows/Linux).
2. Click the `…` menu at the top of the view, then **Install from VSIX…**.
3. Select `vscode-extension/time-tracker-vscode-extension-0.2.0.vsix` and reload VS Code when prompted.

**From the terminal**
```bash
code --install-extension vscode-extension/time-tracker-vscode-extension-0.2.0.vsix
```
> On macOS, if `code` is not found, open the Command Palette in VS Code and run **Shell Command: Install 'code' command in PATH**.

### Option B: build it yourself

```bash
cd vscode-extension
npm install
npm test          # compiles TypeScript and runs unit tests
npm run package   # produces time-tracker-vscode-extension-<version>.vsix
code --install-extension time-tracker-vscode-extension-0.2.0.vsix
```

### Option C: run in development mode

Open the `vscode-extension/` folder in VS Code and press **F5**. A new *Extension Development Host* window starts with the extension loaded; the TypeScript build runs automatically first.

### Configure it

Open **Settings** (`⌘,` / `Ctrl+,`) and search for **Time Tracker**, or add this to your `settings.json`:

```jsonc
{
  // Send events to the local backend (without this, events are only written to the local log)
  "timeTracker.backendUrl": "http://localhost:3000/events",

  // Optional: shown on the dashboard. Auto-detected when empty.
  "timeTracker.githubUsername": "your-github-login",
  "timeTracker.displayName": "Your Name"
}
```

**Avatar and name.** The extension never prompts you to sign in. It reuses a GitHub account that is already signed in to VS Code. Sign in through the **Accounts** icon (bottom-left) → *Sign in with GitHub* (for example, via GitHub Copilot or Pull Requests). Alternatively, set `timeTracker.githubUsername`. Your display name falls back to `git config user.name`, then to your OS username.

**Check that it works**
- Edit a file for a minute, then open http://localhost:8080. You should appear in the *Developers* table.
- Command Palette → **Time Tracker: Open Local Log File** shows the raw events.
- Make a commit in VS Code (or in a terminal inside a workspace folder). It appears under *Recent commits*.

## Using the dashboard

- **Range:** *Today*, *7d*, *30d* or *All* (top bar). The daily chart always covers at most the last 30–90 days.
- **Filter by developer:** click a row in the *Developers* table (click again to clear) or use the selector.
- **Theme:** the moon/sun button toggles light and dark. The choice is saved in the browser.
- **Settings** (sliders icon): API URL and auto-refresh. The API URL is auto-detected: `/api` behind the bundled nginx, otherwise `http://localhost:3000`.
- **Column meanings:**
  - *Commits*: commits recorded by the extension in the selected range.
  - *GitHub commits*: all-time commits you authored in public, non-fork GitHub repositories (from GitHub's search API). Private work is not included.
  - *Status*: **Coding now** = an event in the last 5 minutes; **Away** = within the last hour.

## Local development without Docker

```bash
# 1. Database only
docker compose up -d db

# 2. Backend with hot reload
cd app
npm install
echo 'DATABASE_URL=postgresql://postgres:postgres@localhost:5432/time_tracker?schema=public' > .env
npx prisma db push      # create/update tables
npm run dev             # http://localhost:3000, docs at /docs

# 3. Dashboard (a static file, no build step)
cd ../frontend
python3 -m http.server 8080   # http://localhost:8080
```

Without nginx there is no `/api` proxy. The dashboard falls back to `http://localhost:3000` automatically, and CORS allows `localhost:8080` by default (see `CORS_ORIGINS`).

## Configuration reference

### Docker Compose / backend environment

| Variable        | Default                    | Description |
|-----------------|----------------------------|-------------|
| `FRONTEND_PORT` | `8080`                     | Host port of the dashboard |
| `BACKEND_PORT`  | `3000`                     | Host port of the API |
| `DB_PORT`       | `5432`                     | Host port of PostgreSQL |
| `GITHUB_TOKEN`  | *(empty)*                  | Optional GitHub token, no scopes needed. Raises GitHub API limits from 60 to 5,000 requests/hour. |
| `DATABASE_URL`  | set by compose             | PostgreSQL connection string |
| `CORS_ORIGINS`  | `http://localhost:8080,http://127.0.0.1:8080` | Comma-separated origins allowed to call the API directly |
| `PORT`          | `3000`                     | Port the backend listens on inside its container or process |

### Extension settings (`timeTracker.*`)

| Setting              | Default | Description |
|----------------------|---------|-------------|
| `enabled`            | `true`  | Turn tracking on or off |
| `backendUrl`         | `""`    | Events endpoint, e.g. `http://localhost:3000/events`. Empty = local log only. |
| `intervalSeconds`    | `60`    | Heartbeat interval while you are active |
| `idleTimeoutSeconds` | `300`   | Stop counting after this long without activity |
| `trackCommits`       | `true`  | Record your commits from the built-in Git extension |
| `githubUsername`     | `""`    | GitHub login for avatar and links (auto-detected when empty) |
| `displayName`        | `""`    | Name on the dashboard (defaults to `git config user.name`) |
| `token`              | `""`    | Sent as `Authorization: Bearer …`. Reserved for future multi-user deployments; the local backend does not check it. |
| `logFilePath`        | `""`    | Override the local log location (`~/.time-tracker/events.jsonl`) |

## API

Interactive docs are at **http://localhost:3000/docs** (or `http://localhost:8080/api/docs`).

| Method | Path                 | Description |
|--------|----------------------|-------------|
| `POST` | `/events`            | Ingest an event from the extension. Events of type `commit` also store the commit (deduplicated by hash). |
| `GET`  | `/events?user=&limit=` | Most recent raw events (default 100, max 1000) |
| `GET`  | `/stats/summary?days=&user=&tz=` | Everything the dashboard needs: totals, per-developer summary, languages, projects, daily series and recent commits. `days=0` = all time. |
| `GET`  | `/github/:login`     | GitHub name, avatar and public commit count (cached for 15 minutes) |
| `GET`  | `/health`            | Liveness check |
| `GET/POST` | `/users`, `/time`, `/smile` | Legacy CRUD endpoints kept for compatibility |

## How coding time is calculated

1. The extension emits an event when you switch files, at most once every 30 seconds while you type, and every `intervalSeconds` while you are active.
2. Each event carries `elapsedMs`, the time since the previous event.
3. If there has been no activity for `idleTimeoutSeconds`, heartbeats stop and the idle gap is discarded.
4. The backend sums `elapsedMs` and caps any single gap at 5 minutes, which guards against sleep/suspend.

> Events recorded by extension **0.1.0** were sent on every keystroke and kept arriving while VS Code sat idle. Totals for that period are therefore higher than real coding time; data recorded with 0.2.0 is accurate.

## Scope: local today, global later

The current setup targets **one developer on one machine**:

- All ports are bound to `127.0.0.1`, so nothing is reachable from your network.
- There is **no authentication**. Anyone who can reach the API can read and write data.
- PostgreSQL uses default credentials (`postgres/postgres`).
- The schema is synced with `prisma db push`, which suits a local database.
- The only outbound traffic is GitHub profile lookups from the backend and avatar images loaded by your browser.

The design leaves room for **team or global use** later. The extension already sends a bearer token, events carry hostname, user and GitHub identity, and stats can be filtered per developer. Before deploying for a team, plan for:

1. **Authentication:** validate per-user API tokens on `POST /events`, and add a dashboard login (e.g. GitHub OAuth).
2. **Network:** put the stack behind HTTPS (Caddy, Traefik or nginx with TLS), remove the `127.0.0.1` binding only on the reverse proxy, and restrict `CORS_ORIGINS`.
3. **Secrets:** move database credentials and `GITHUB_TOKEN` to a secrets manager or a non-committed `.env`.
4. **Database:** switch to `prisma migrate deploy`, add backups and a retention policy for raw events, and consider daily aggregate tables for large teams.
5. **Reliability:** buffer events in the extension while the backend is offline and retry them later; add rate limiting on ingestion.
6. **Distribution:** publish the extension to the VS Code Marketplace (`npx @vscode/vsce publish`) or attach the `.vsix` to GitHub Releases.

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `Bind for 0.0.0.0:8080 failed: port is already allocated` | Another service uses the port. Set `FRONTEND_PORT` / `BACKEND_PORT` / `DB_PORT` (see [Busy ports](#busy-ports)). |
| Dashboard says *Cannot load data* | Check `docker compose ps` and `docker compose logs backend`. In Settings (sliders icon), clear the API URL so it is auto-detected again. |
| Dashboard is empty | Make sure `timeTracker.backendUrl` is set and VS Code was reloaded after installing the extension. Use **Time Tracker: Open Local Log File** to confirm events are written locally. |
| Initials instead of a GitHub photo | Set `timeTracker.githubUsername`, or sign in to GitHub in VS Code. A login that does not exist on GitHub always shows initials. |
| *GitHub commits* shows `—` | GitHub was unreachable or rate-limited (60 req/h, 10 searches/min without a token). Set `GITHUB_TOKEN` and restart the backend. |
| Commits are not recorded | The built-in **Git** extension must be enabled and the repository opened as a workspace folder. Only commits by your `user.email` on the current branch are counted. |

## Project structure

```
.
├── docker-compose.yml        # db + backend + frontend, local-only port bindings
├── app/                      # Backend: Fastify + Prisma
│   ├── prisma/schema.prisma  # Event, Commit (+ legacy User, TimeRecord)
│   ├── server.ts
│   └── src/
│       ├── index.ts          # app factory, plugin & route registration
│       ├── plugins/          # prisma, cors, swagger, health
│       └── routers/          # events, stats, github, users, time, smile
├── frontend/                 # Dashboard: a single dependency-free index.html
│   ├── index.html
│   └── nginx.conf            # serves the page and proxies /api → backend
└── vscode-extension/         # VS Code extension (TypeScript)
    ├── src/extension.ts
    ├── test/                 # node:test unit tests
    └── time-tracker-vscode-extension-0.2.0.vsix
```
