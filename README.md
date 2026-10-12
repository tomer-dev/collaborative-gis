# Collaborative GIS

Real-time collaborative polygon drawing on Leaflet with OpenStreetMap and govmap aerial imagery. Hono on Cloudflare Workers + Durable Objects, PostGIS on Neon via Hyperdrive, Better Auth, React + Vite + TanStack.

Planning and decisions: `docs/roadmap.md`, `docs/research-notes.md`, `docs/superpowers/specs/2026-10-12-collaborative-gis-design.md` (decision log in §10), `docs/decisions-brief.html`, `docs/process-log.md` (how the work was done, task by task), ADRs in `docs/adr/`, tunable values in `docs/constants.md`.

## Setup

Prerequisites: Node 22 (`.node-version` pins 22.23.3; `engines` requires `>=22.22.2`), pnpm 12.5.1 (pinned by `packageManager`), Docker. Wrangler and the Hono CLI (`@hono/cli`) are dev dependencies of `apps/api` and are installed by pnpm.

Workspace:

- `packages/shared` (`@cgis/shared`): Zod 4 contracts used by both apps (polygon, area, bounds query, API error, WebSocket protocol) and every tunable value, one file per domain under `src/constants/`. `docs/constants.md` is generated from them (`pnpm constants:docs`; CI fails when it is stale).
- `apps/api` (`@cgis/api`): Hono 4 Worker with two Durable Objects (`Room`: presence, live drafts, area fan-out; `RateLimiter`: the per-user budget), PostGIS through the `HYPERDRIVE` binding, Better Auth.
- `apps/web` (`@cgis/web`): Vite 8 + React 19 + TanStack Router/Query + Leaflet 1.9.4 SPA; Storybook for the design system.

First run:

```bash
pnpm install
pnpm db:up && pnpm db:check                        # local PostGIS 18 / 3.6 on 127.0.0.1:5433
DATABASE_URL=postgresql://cgis:cgis@127.0.0.1:5433/cgis pnpm --filter @cgis/api db:migrate
cp apps/api/.dev.vars.example apps/api/.dev.vars  # then set BETTER_AUTH_SECRET (openssl rand -base64 32)
pnpm typecheck                                     # also generates apps/api/worker-configuration.d.ts
pnpm dev                                           # wrangler dev on :8787 and Vite on :5173
```

Open http://localhost:5173, create an account and draw on `/map`; a second browser profile (or a private window) is a second user. Vite proxies `/api` and `/ws` to `wrangler dev`, so the SPA and the API share one origin. `CLIENT_ORIGIN` in `apps/api/wrangler.jsonc` must be the SPA's origin: the CORS policy, Better Auth's trusted origins and the WebSocket origin gate all read it. If 5173 is taken, run Vite on another port and pass `wrangler dev --var CLIENT_ORIGIN:http://localhost:<port>`.

Day to day:

```bash
pnpm test                            # shared, web (jsdom), api (workerd, against the local PostGIS)
pnpm lint && pnpm format:check && pnpm typecheck && pnpm constants:docs --check
pnpm --filter @cgis/web storybook    # design system on :6006
pnpm db:down                         # stop the local database
```

Without a dev server, `pnpm --filter @cgis/api exec hono request /readyz --runtime workerd` sends one request to the Worker on workerd, and `pnpm --filter @cgis/api exec hono batch batch/areas.jsonl --runtime workerd` runs the areas API contract (CI runs it too); `apps/api/AGENTS.md` lists the other Hono CLI commands.

Environment: `.env.example` documents the local and Neon variables, `apps/api/.dev.vars.example` the Worker secrets (`BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`). Locally, the `HYPERDRIVE` binding uses `localConnectionString` from `apps/api/wrangler.jsonc`, which points at the compose database; `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` overrides it (`scripts/db-lane.sh` makes a separate database).

Database setup for Neon (production): create the project with `neonctl projects create`, enable PostGIS with `create extension if not exists postgis` over the **direct** connection, create a Hyperdrive config with `wrangler hyperdrive create` (query caching off: writes do not invalidate it), and put its id in `apps/api/wrangler.jsonc`. Migrations always run against the direct URL; the Worker only ever sees the Hyperdrive binding. This is done: Neon project `winter-credit-61110991` (aws-eu-central-1, PostgreSQL 18 / PostGIS 3.6.4), Hyperdrive config `cgis-neon`. The Neon API key is never stored in the repository; it is injected per command from 1Password with `op run` (see `.env.example`).

## Migrations

Migrations always run against a **direct** database URL, never through Hyperdrive. Hyperdrive is the Worker's runtime path only: the Worker reaches the database solely through the `HYPERDRIVE` binding.

- Schema: `apps/api/src/db/schema.ts` (areas, area versions, audit log) and `apps/api/src/db/auth-schema.ts` (Better Auth). After changing either, run `pnpm --filter @cgis/api db:generate`. It writes the next `apps/api/drizzle/NNNN_*.sql`; commit that file together with `drizzle/meta`. `0000_postgis.sql` is hand-written: `create extension if not exists postgis`.
- Apply: `DATABASE_URL=<direct URL> pnpm --filter @cgis/api db:migrate`. Applied migrations are recorded in `drizzle.__drizzle_migrations`, so a rerun is a no-op.
- Locally, the direct URL is `postgresql://cgis:cgis@127.0.0.1:5433/cgis`; migrate it before running the workerd tests that need tables. A lane database from `scripts/db-lane.sh` works the same way.
- In production, use the Neon direct (non-pooled) URL (`NEON_DATABASE_URL` in `.env.example`), injected from 1Password with `op run`.
- CI migrates the runner's PostGIS before `pnpm test`.
- `apps/api/test/db` is a Node Vitest project (`db` in `apps/api/vitest.config.ts`), because `migrate()` reads the SQL files from disk. On every run, its global setup creates `cgis_db` with `scripts/db-lane.sh`, empties it and migrates it from scratch.

Coordinate order: all GeoJSON in this project is `[longitude, latitude]`; Leaflet's own API is `[lat, lng]`. The shared schema cannot detect a swap when both values are in range.

## Deploy

One Worker, `collaborative-gis` (`env.production` in `apps/api/wrangler.jsonc`), serves the built SPA as static assets and the API, the WebSocket and both Durable Objects on one origin; Neon is reached through Hyperdrive with query caching off.
`.github/workflows/deploy.yml` deploys on every push to `main` and on demand: it migrates Neon over the direct URL, builds the web and runs `wrangler deploy --env production`. It is skipped until the repository has the `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` and `DATABASE_URL` secrets.
The one-time owner checklist (Hyperdrive caching, production origin, `BETTER_AUTH_SECRET`, first deploy), smoke checks and rollback: [`docs/deploy.md`](docs/deploy.md).

## Technical decisions and architecture

The decision log is §10 of the design spec, [`docs/superpowers/specs/2026-10-12-collaborative-gis-design.md`](docs/superpowers/specs/2026-10-12-collaborative-gis-design.md) (D1–D25), with ADRs 0001–0004 in `docs/adr/`. The ones that shape the code most:

- Cloudflare Workers + Durable Objects (ADR-0001), Hono (ADR-0002), Leaflet 1.9.4 with Proj4Leaflet for the EPSG:2039 layer (ADR-0003, D22).
- One `Room` Durable Object per map (D7, D11): presence, live drafts and area fan-out over the WebSocket Hibernation API. The realtime protocol is our own code.
- Optimistic concurrency: `PUT /api/areas/:id` carries the version the edit started from; a stale one is 409 with the stored area, and the client asks the user (D4).
- An `audit_log` row is written in the same transaction as each area mutation (D20); every query goes through the Drizzle builder, with `sql` only for PostGIS fragments and the atomic write CTEs (D23).
- HTTP clients: Better Auth's React client for auth, Hono's `hc` typed from the api's `AppType` for the areas API (D19). The SPA reads `AppType` from the api's emitted declarations.
- The product brief says "No third-party plugins for the collaborative features". It is read narrowly (D25): collaboration SDKs (Yjs, partyserver, Liveblocks and the like) are out, and the presence and draft protocol is hand-written; map drawing is not a collaborative feature, so the draw tool is a thin adapter over `leaflet-editable` 1.3.2, and polygon area and self-intersection use `@turf/area` and `@turf/kinks`. PostGIS stays the authority (`ST_IsValid`, `ST_Area(geography)`).

## Performance considerations

Spatial index, geodesic area, cache keys, benchmarks: tickets 1.3, 1.4, 1.7, 3.6, 6.6.

## Security measures

- Sessions: Better Auth with email and password (scrypt hashing, D21), `httpOnly` + `SameSite=Lax` cookies (`Secure` and the `__Secure-` prefix under an https `BETTER_AUTH_URL`). Better Auth checks Origin on its own routes against `CLIENT_ORIGIN`.
- Session cookie cache (D24): Better Auth keeps a signed copy of the session in a second cookie for `AUTH.COOKIE_CACHE_MAX_AGE_S` (5 minutes), and a request carrying a valid copy is authenticated without reading the session row. Signing out on the same device clears both cookies at once; a session revoked elsewhere (another device, an admin) stays usable on a device that still holds the cookie for up to 5 minutes.
- WebSocket origin gate: `GET /ws` needs a session, then an `Origin` equal to `CLIENT_ORIGIN` (403 otherwise). Better Auth's session lookup ignores Origin, so without the gate another site could open a socket with a visitor's cookie.
- Sign-in rate limit: once deployed (https `BETTER_AUTH_URL`), Better Auth answers 429 after `AUTH.RATE_LIMIT_MAX` (10) sign-in attempts per client IP per 60 s, counted per Worker isolate; a Cloudflare WAF rate rule on `/api/auth/*` is the global limit. The production checklist (WAF rule, `/readyz` health check, logs, rollback) is in [`docs/deploy.md`](docs/deploy.md#production-hardening).
- Rate limit (D5): every area mutation spends one action from an exact per-user sliding window in the `RateLimiter` Durable Object, 50 per 60 s (`RATE_LIMIT`); over it the API answers 429 with `Retry-After`. A limiter failure fails the request closed. Drafts on the socket have their own per-socket token bucket in the Room.
- Input: every body, query and path parameter is parsed with the shared Zod schemas (422 `UNPROCESSABLE` with the issues), and PostGIS validates every polygon (`ST_IsValidReason` in a 422). All SQL values are bound parameters.
- Responses: CORS allows `CLIENT_ORIGIN` only, Hono's secure headers on every response, a 10 s request budget (504), a fresh server-generated request id on every response and log line, secrets redacted from logs (`LOG.REDACT_KEYS`), and fixed `ApiError` bodies for 404/500/503 that never echo internal errors.
- Repository: no secrets committed; the local database listens on 127.0.0.1 only.

## Known limitations

- govmap imagery rests on the legacy ITM tile caches on `cdn.govmap.gov.il`, which answer without a referrer check but are no longer updated (newest tiles from 2024-01). The current EPSG:3857 endpoint is locked to govmap's own referrer and unusable without a proxy, which D3 rules out. govmap could retire the legacy caches without notice.
- Better Auth's scrypt hashing needs more CPU than the Workers Free plan allows: deploying needs Workers Paid (D21).
- A session revoked on another device keeps working for up to 5 minutes where its cookie cache is still valid (D24).
- One map room (D11); an area event that lands between a viewport's first GET and the socket's first join is picked up on the next pan or reconnect.
- The local database listens on port 5433 (not 5432, to avoid a local Postgres), bound to 127.0.0.1 only; local PostGIS is the community multi-arch `imresamu/postgis:18-3.6` image.

## Future improvements and scaling

See [ADR-0004: Horizontal scaling on Cloudflare](docs/adr/0004-horizontal-scaling-on-cloudflare.md) (ticket 4.9): where state lives, platform limits, and the growth path (tile-sharded rooms, Queues, metrics export, multi-region).

## Testing approach

Unit (Vitest), Worker + Durable Object integration (`@cloudflare/vitest-plugin`), API contract suite (`hono batch`), two-browser Playwright E2E: tickets 6.1–6.3. In place since M0: Vitest in all three packages (api tests run in workerd against the local PostGIS), and CI (`.github/workflows/ci.yml`) runs lint, format check, typecheck, tests with a PostGIS service and `wrangler deploy --dry-run` on every pull request and push to `main`.
