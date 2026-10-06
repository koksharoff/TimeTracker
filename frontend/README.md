# Time Tracker — Dashboard

A single, dependency-free `index.html`: a minimalist blue-and-white dashboard with a dark theme. In Docker it is served by nginx, which also proxies `/api/*` to the backend, so no CORS setup is needed.

See the [root README](../README.md) for the full setup guide.

## Run

**With Docker** (from the repository root):

```bash
docker compose up -d --build
# http://localhost:8080
```

**Without Docker:**

```bash
cd frontend
python3 -m http.server 8080
# http://localhost:8080 — the API is auto-detected at http://localhost:3000
```

You can also open `index.html` directly from disk. If the API is on another host or port, set it under **Settings** (sliders icon).

## What it shows

- KPIs: coding time, tracked commits, developers (and who is coding now), events
- Developers table: GitHub avatar and name, `@login`, status, coding time, commits, public GitHub commits, top language, machine, last activity
- Daily activity chart (commit days are marked), languages, projects
- Recent commits and raw activity

## Files

- `index.html`: the whole app (HTML, CSS, JS). Theme, range, filter and API URL are remembered in `localStorage`.
- `nginx.conf`: static hosting plus the `/api/` → `backend:3000` proxy.
- `Dockerfile`: `nginx:alpine` image.
