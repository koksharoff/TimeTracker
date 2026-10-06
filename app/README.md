# Time Tracker — Backend

Fastify + Prisma + PostgreSQL API that stores events from the VS Code extension and serves aggregated stats to the dashboard. OpenAPI docs are at `/docs`.

See the [root README](../README.md) for the full setup guide.

## Run with Docker (recommended)

From the repository root:

```bash
docker compose up -d --build
docker compose logs -f backend
```

## Run locally

```bash
docker compose up -d db                     # from the repository root
cd app
npm install
echo 'DATABASE_URL=postgresql://postgres:postgres@localhost:5432/time_tracker?schema=public' > .env
npx prisma db push                          # create/update tables
npm run dev                                 # hot reload on http://localhost:3000
```

Production build:

```bash
npm run build
npm run start:prod
```

## Environment

| Variable       | Default | Description |
|----------------|---------|-------------|
| `DATABASE_URL` | built from `PG*` variables | PostgreSQL connection string |
| `PORT`         | `3000`  | Listen port |
| `CORS_ORIGINS` | `http://localhost:8080,http://127.0.0.1:8080` | Comma-separated allowed origins |
| `GITHUB_TOKEN` | *(empty)* | Optional; raises GitHub API rate limits for `/github/:login` |

## Routes

| Route | Purpose |
|-------|---------|
| `POST /events`, `GET /events` | Ingest and list raw extension events (commit events also fill the `Commit` table) |
| `GET /stats/summary` | Dashboard aggregates (`days`, `user`, `tz` query parameters) |
| `GET /github/:login` | Cached GitHub profile, avatar and public commit count |
| `GET /health` | Liveness check |
| `/users`, `/time`, `/smile` | Legacy endpoints |

## Notes

- The schema is applied with `prisma db push` when the container starts. This fits the local, single-user scope; use `prisma migrate` for shared deployments.
- Stats queries use raw SQL (PostgreSQL-specific) and cap any single gap between events at 5 minutes.
