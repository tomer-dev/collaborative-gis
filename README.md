# Collaborative GIS

Real-time collaborative polygon drawing on Leaflet with OpenStreetMap and govmap aerial imagery. Hono on Cloudflare Workers + Durable Objects, PostGIS on Neon via Hyperdrive, Better Auth, React + Vite + TanStack.

Planning and decisions: `docs/roadmap.md`, `docs/research-notes.md`, `docs/superpowers/specs/2026-10-12-collaborative-gis-design.md`, `docs/decisions-brief.html`, `docs/process-log.md`, ADRs in `docs/adr/`.

## Setup

Prerequisites: Node 22 (`.node-version` pins 22.23.3; `engines` requires `>=22.22.2`), pnpm 12.5.1 (pinned by `packageManager`), Docker. Wrangler and the Hono CLI (`@hono/cli`) are dev dependencies of `apps/api` and are installed by pnpm.

Workspace:

- `packages/shared` (`@cgis/shared`): Zod 4 contracts used by both apps (polygon, area, bounds query, API error, WebSocket envelope).
- `apps/api` (`@cgis/api`): Hono 4 Worker. `GET /healthz`; `GET /readyz` pings the database through the `HYPERDRIVE` binding and the Room Durable Object (`getVersion()` within `TIMEOUTS.DO_PING_MS`) and answers 503 `NOT_READY` with `details: { db, room }` when either does not answer.
- `apps/web` (`@cgis/web`): Vite 8 + React 19 placeholder.

```bash
pnpm install
pnpm db:up && pnpm db:check          # local PostGIS 18 / 3.6 on 127.0.0.1:5433 with the extension enabled
pnpm test                            # shared, web (jsdom), api (workerd, against the local PostGIS)
pnpm --filter @cgis/api dev          # Worker on http://localhost:8787 (workerd, Hyperdrive → local PostGIS)
pnpm --filter @cgis/web dev          # Vite on http://localhost:5173
pnpm typecheck && pnpm lint && pnpm format:check
pnpm db:down                         # stop the local database
```

Without a dev server, `pnpm --filter @cgis/api exec hono request /readyz --runtime workerd` sends a request to the Worker on workerd; `apps/api/AGENTS.md` lists the other Hono CLI commands.

Environment: `.env.example` documents the local and Neon variables, `apps/api/.dev.vars.example` the local Worker secrets (none are required yet). Locally, the `HYPERDRIVE` binding uses `localConnectionString` from `apps/api/wrangler.jsonc`, which points at the compose database.

Database setup for Neon (production): create the project with `neonctl projects create`, enable PostGIS with `create extension if not exists postgis` over the **direct** connection, create a Hyperdrive config with `wrangler hyperdrive create`, and put its id in `apps/api/wrangler.jsonc`. Migrations always run against the direct URL (ticket 1.2); the Worker only ever sees the Hyperdrive binding. This is done: Neon project `winter-credit-61110991` (aws-eu-central-1, PostgreSQL 18 / PostGIS 3.6.4), Hyperdrive config `cgis-neon`. The Neon API key is never stored in the repository; it is injected per command from 1Password with `op run` (see `.env.example`).

## Migrations

Migrations always run against a **direct** database URL, never through Hyperdrive. Hyperdrive is the Worker's runtime path only: the Worker reaches the database solely through the `HYPERDRIVE` binding.

- Schema: `apps/api/src/db/schema.ts` (areas, area versions, audit log) and `apps/api/src/db/auth-schema.ts` (Better Auth). After changing either, run `pnpm --filter @cgis/api db:generate`. It writes the next `apps/api/drizzle/NNNN_*.sql`; commit that file together with `drizzle/meta`. `0000_postgis.sql` is hand-written: `create extension if not exists postgis`.
- Apply: `DATABASE_URL=<direct URL> pnpm --filter @cgis/api db:migrate`. Applied migrations are recorded in `drizzle.__drizzle_migrations`, so a rerun is a no-op.
- Locally, the direct URL is `postgresql://cgis:cgis@127.0.0.1:5433/cgis`; migrate it before running the workerd tests that need tables. A lane database from `scripts/db-lane.sh` works the same way.
- In production, use the Neon direct (non-pooled) URL (`NEON_DATABASE_URL` in `.env.example`), injected from 1Password with `op run`.
- CI migrates the runner's PostGIS before `pnpm test`.
- `apps/api/test/db` is a Node Vitest project (`db` in `apps/api/vitest.config.ts`), because `migrate()` reads the SQL files from disk. On every run, its global setup creates `cgis_db` with `scripts/db-lane.sh`, empties it and migrates it from scratch.

Coordinate order: all GeoJSON in this project is `[longitude, latitude]`; Leaflet's own API is `[lat, lng]`. The shared schema cannot detect a swap when both values are in range.

## Technical decisions and architecture

See ADRs 0001–0003 and the spec. Filled further by tickets 4.9 and 6.5.

## Performance considerations

Spatial index, geodesic area, cache keys, benchmarks: tickets 1.3, 1.4, 1.7, 3.6, 6.6.

## Security measures

Tickets 2.1–2.8, 7.5. In place since M0: no secrets in the repository, the local database is bound to loopback only, and 404, 500 and failed `/readyz` responses return fixed `ApiError` bodies that never echo internal errors.

Session cookie cache (D24): Better Auth keeps a signed copy of the session in a second cookie for `AUTH.COOKIE_CACHE_MAX_AGE_S` (5 minutes), and a request carrying a valid copy is authenticated without reading the session row. Signing out on the same device clears both cookies at once; a session revoked elsewhere (another device, an admin) stays usable on a device that still holds the cookie for up to 5 minutes.

## Known limitations

- The local database listens on port 5433 (not 5432, to avoid a local Postgres), bound to 127.0.0.1 only.
- Local PostGIS is the community multi-arch `imresamu/postgis:18-3.6` image; Docker Hub's `postgis/postgis` is amd64-only.
- No application features yet: M0 is the foundation (workspace, contracts, health endpoints, database wiring, CI).
- Expanded by ticket 6.5.

## Future improvements and scaling

See [ADR-0004: Horizontal scaling on Cloudflare](docs/adr/0004-horizontal-scaling-on-cloudflare.md) (ticket 4.9): where state lives, platform limits, and the growth path (tile-sharded rooms, Queues, metrics export, multi-region).

## Testing approach

Unit (Vitest), Worker + Durable Object integration (`@cloudflare/vitest-plugin`), API contract suite (`hono batch`), two-browser Playwright E2E: tickets 6.1–6.3. In place since M0: Vitest in all three packages (api tests run in workerd against the local PostGIS), and CI (`.github/workflows/ci.yml`) runs lint, format check, typecheck, tests with a PostGIS service and `wrangler deploy --dry-run` on every pull request and push to `main`.
