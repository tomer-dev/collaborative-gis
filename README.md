# Collaborative GIS

Real-time collaborative polygon drawing on Leaflet with OpenStreetMap and govmap aerial imagery. Hono on Cloudflare Workers + Durable Objects, PostGIS on Neon via Hyperdrive, Better Auth, React + Vite + TanStack.

Reviewer guide (presentation): served by the app at `/guide/` (URL in the submission note); one page with screenshots, numbers and file pointers for each requirement of the product brief. On GitHub the file shows as source, so open [`apps/web/public/guide/index.html`](apps/web/public/guide/index.html) from a checkout.

## Documentation map

- [`docs/roadmap.md`](docs/roadmap.md): epics, tickets, milestones and the critical path.
- [`docs/research-notes.md`](docs/research-notes.md): the pre-roadmap reading per technology, each fact with the decision it drives.
- [`docs/superpowers/specs/2026-10-12-collaborative-gis-design.md`](docs/superpowers/specs/2026-10-12-collaborative-gis-design.md): the design spec; §10 is the decision log (D1–D25). The milestone plans are in [`docs/superpowers/plans/`](docs/superpowers/plans/), and `docs/decisions-brief.html` is the decisions brief (open it locally).
- [`docs/adr/`](docs/adr/): architecture decision records, listed under [Technical decisions](#technical-decisions-and-architecture).
- [`docs/process-log.md`](docs/process-log.md): how the work was done, task by task, with the rulings that changed scope.
- [`docs/benchmarks.md`](docs/benchmarks.md): the bounds query with and without the GiST index (`db:explain`).
- [`docs/benchmarks-load.md`](docs/benchmarks-load.md): k6 load results for REST and WebSocket; scripts in [`bench/README.md`](bench/README.md).
- [`docs/deploy.md`](docs/deploy.md): production deploy, owner checklist, smoke checks, rollback and hardening.
- [`docs/constants.md`](docs/constants.md): every tunable value, generated from `packages/shared/src/constants/`.
- [`apps/web/e2e/README.md`](apps/web/e2e/README.md): the two-browser Playwright run.

## Setup

Prerequisites: Node 26 (`.node-version` pins 26.11.1; `engines` requires `>=26.11.1`), pnpm 12.5.1 (pinned by `packageManager`), Docker (Compose v2 or later; to run the API without Node on the host, see [API in a container](#api-in-a-container)). Wrangler and the Hono CLI (`@hono/cli`) are dev dependencies of `apps/api` and are installed by pnpm.

Workspace:

- `packages/shared` (`@cgis/shared`): Zod 4 contracts used by both apps (polygon, area, bounds query, API error, WebSocket protocol) and every tunable value, one file per domain under `src/constants/`. `docs/constants.md` is generated from them (`pnpm constants:docs`; CI fails when it is stale).
- `apps/api` (`@cgis/api`): Hono 4 Worker with two Durable Objects (`Room`: presence, live drafts, area fan-out; `RateLimiter`: the per-user budget), PostGIS through the `HYPERDRIVE` binding, Better Auth. `GET /healthz` is liveness; `GET /readyz` pings the database and the Room (`getVersion()` within `TIMEOUTS.DO_PING_MS`), checks that `CLIENT_ORIGIN` and `BETTER_AUTH_URL` are absolute URLs, and answers 200 `{ status: ready, db, room, config }` or 503 `NOT_READY` with `details: { db, room, config }` naming the one that is `down`.
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

Open http://localhost:5173, create an account and draw on `/map`; a second browser profile (or a private window) is a second user. Vite proxies `/api` and `/ws` to `wrangler dev`, so the SPA and the API share one origin. `CLIENT_ORIGIN` in `apps/api/wrangler.jsonc` must be the SPA's origin: the CORS policy, Better Auth's trusted origins and the WebSocket origin gate all read it. If 5173 is taken, run the two servers yourself instead of `pnpm dev`, with the SPA's port in `CLIENT_ORIGIN`: `pnpm --filter @cgis/api dev --var CLIENT_ORIGIN:http://localhost:<port>` and `pnpm --filter @cgis/web dev --port <port> --strictPort`.

### API in a container

`docker compose up` starts only PostGIS; `docker compose --profile api up` also builds and runs the API in a container (`apps/api/Dockerfile.dev`, Node 26.11.1 slim) that migrates the compose database and then runs `wrangler dev --ip 0.0.0.0 --port 8787` on workerd, reachable at http://127.0.0.1:8787. The database is reached service-to-service (`postgis:5432`) through `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE`; Worker secrets come from `apps/api/.dev.vars`, bind-mounted read-only, so copy `.dev.vars.example` and set `BETTER_AUTH_SECRET` before the first `up`. The Vite SPA stays on the host and still needs Node, pnpm and `pnpm install`: `pnpm --filter @cgis/web dev` proxies `/api` and `/ws` to the container. Rebuild after a dependency or source change with `docker compose --profile api up --build`; stop both services with `docker compose --profile api down` (plain `pnpm db:down` ignores the profile). Durable Object state lives in the container under `apps/api/.wrangler/state` and is lost when it is recreated; the database volume persists.

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
- `apps/api/test/db` is a Node Vitest project (`db` in `apps/api/vitest.config.ts`), because `migrate()` reads the SQL files from disk. On every run, its global setup creates `cgis_db_<lane>` and `cgis_db_seed_<lane>` (the seed test's own) with `scripts/db-lane.sh`, empties them and migrates them from scratch; the workerd project's global setup (`apps/api/test/lane-setup.ts`) does the same for its five lane databases.
- Seed: `DATABASE_URL=<direct URL> pnpm --filter @cgis/api db:seed [--count N]` tops the random `seed-*` polygons (created by the `seed` user) up to N (default 50; `--count 10000` for the benchmark set), so a rerun adds nothing. `db:explain` seeds 10,000 and writes the bounds-query EXPLAIN table to [`docs/benchmarks.md`](docs/benchmarks.md).

Coordinate order: all GeoJSON in this project is `[longitude, latitude]`; Leaflet's own API is `[lat, lng]`. The shared schema cannot detect a swap when both values are in range.

## Database access rules

- Reads use the Drizzle query builder with explicit column lists; geometry leaves the database only as `ST_AsGeoJSON(geom)::json` (the `polygon` column type refuses raw reads).
- `sql` is for PostGIS fragments (`ST_MakeEnvelope`, `ST_Area`, `ST_GeomFromGeoJSON`) and for the write CTEs in `apps/api/src/db/spatial.ts` that write an area and its version row in one statement (D23's exception, marked in a comment each); ESLint rejects a `sql` template starting with `SELECT` in `apps/api/src`.
- Rows from those raw statements are Zod-parsed before they leave `spatial.ts`; the Worker reaches the database only through `withClient` (Hyperdrive), scripts and migrations through a direct URL.

## Deploy

One Worker, `collaborative-gis-api-production` (`env.production` in `apps/api/wrangler.jsonc`), serves the built SPA as static assets and the API, the WebSocket and both Durable Objects on one origin; Neon is reached through Hyperdrive with query caching off.
`.github/workflows/deploy.yml` deploys each push to `main` once `ci` has passed on it, and on demand: it migrates Neon over the direct URL, builds the web and runs `wrangler deploy --env production`, passing the origin from the repository variable `PRODUCTION_ORIGIN` (the origin is never in the repository). It is skipped until the repository variable `DEPLOY_ENABLED` is `true`; it needs the `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` and `DATABASE_URL` secrets. Production is live and deployed this way from `main`, on a custom domain attached in the Cloudflare dashboard, outside the repository, which never names the hostname. A Worker deployed without the origin vars answers `/readyz` with 503 and `config: down`.
The one-time owner checklist (Hyperdrive caching, production origin, `BETTER_AUTH_SECRET`, first deploy), smoke checks and rollback: [`docs/deploy.md`](docs/deploy.md).

## Technical decisions and architecture

```mermaid
flowchart LR
  B["Browser: Vite SPA, React, Leaflet"]
  subgraph CF["Cloudflare: one Worker, one origin"]
    W["Worker: Hono API and static assets"]
    R["Room DO: presence, drafts, fan-out (WebSocket hibernation)"]
    L["RateLimiter DO: per-user budget"]
    C[("Workers Cache: bounds reads")]
    H["Hyperdrive"]
  end
  N[("Neon PostGIS")]
  G["GitHub Actions"]
  B -- "HTTPS: /api, SPA files" --> W
  B -- "WebSocket /ws" --> W
  W -- "upgrade, map version, broadcast" --> R
  W -- "REST mutation budget" --> L
  R -- "draft session budget" --> L
  W -- "GET /api/areas by tile and version" --> C
  W --> H --> N
  G -- "wrangler deploy --env production" --> W
  G -- "migrations, direct URL" --> N
```

The decision log is §10 of the design spec, [`docs/superpowers/specs/2026-10-12-collaborative-gis-design.md`](docs/superpowers/specs/2026-10-12-collaborative-gis-design.md) (D1–D25). The architecture decision records:

- [ADR-0001: Cloudflare Workers + Durable Objects instead of Vercel](docs/adr/0001-cloudflare-over-vercel.md)
- [ADR-0002: Hono instead of Fastify](docs/adr/0002-hono-over-fastify.md)
- [ADR-0003: Leaflet 1.9.4 and a hand-rolled EPSG:2039 CRS on proj4](docs/adr/0003-leaflet-1-9-4-and-proj4-crs.md) (superseded by ADR-0005)
- [ADR-0004: Horizontal scaling on Cloudflare](docs/adr/0004-horizontal-scaling-on-cloudflare.md)
- [ADR-0005: govmap aerial imagery through a CRS swap to EPSG:2039](docs/adr/0005-govmap-crs-swap.md)

The decisions that shape the code most:

- Cloudflare Workers + Durable Objects (ADR-0001), Hono (ADR-0002), Leaflet 1.9.4 with Proj4Leaflet for the EPSG:2039 aerial layer, swapped in with the map's CRS (ADR-0005, D3, D22).
- One `Room` Durable Object per map (D7, D11): presence, live drafts and area fan-out over the WebSocket Hibernation API. The realtime protocol is our own code.
- Optimistic concurrency: `PUT /api/areas/:id` carries the version the edit started from; a stale one is 409 with the stored area, and the client asks the user (D4).
- An `audit_log` row is written in the same transaction as each area mutation (D20); every query goes through the Drizzle builder, with `sql` only for PostGIS fragments and the atomic write CTEs (D23).
- HTTP clients: Better Auth's React client for auth, Hono's `hc` typed from the api's `AppType` for the areas API (D19). The SPA reads `AppType` from the api's emitted declarations.
- The product brief says "No third-party plugins for the collaborative features". It is read narrowly (D25): collaboration SDKs (Yjs, partyserver, Liveblocks and the like) are out, and the presence and draft protocol is hand-written; map drawing is not a collaborative feature, so the draw tool is a thin adapter over `leaflet-editable` 1.3.2, and polygon area and self-intersection use `@turf/area` and `@turf/kinks`. PostGIS stays the authority (`ST_IsValid`, `ST_Area(geography)`).

## Performance considerations

- Spatial index: a GiST index on `areas.geom`. With 10,000 areas the viewport query runs at p50 0.17 ms / p95 0.22 ms on the index, against 1.18 ms / 1.33 ms with index scans off (server execution time; [`docs/benchmarks.md`](docs/benchmarks.md), `pnpm --filter @cgis/api db:explain`).
- Load, measured locally against `wrangler dev` with k6 (`pnpm bench`, not run in CI; [`docs/benchmarks-load.md`](docs/benchmarks-load.md)): 10 users for 1 minute, 1600 viewport reads and 400 creates, read p95 86 ms, write p95 132 ms, no errors and no 429; 5 sockets drawing at 10 frames per second for 30 s, every draft frame reached every other user within 1 s (6000 of 6000; delay p95 8 ms).
- Bounded payloads: a viewport answers at most `LIMITS.BOUNDS_LIMIT` (500) areas, an area's history at most `LIMITS.VERSIONS_PAGE` (200) versions, and a mutation body at most `LIMITS.BODY_MAX_BYTES` (64 KiB, else 413).
- Geodesic area: `ST_Area(geom::geography)` on every write, stored with the row and each version, so reads never compute it.

Viewport cache (D6): `GET /api/areas` snaps the bbox outward to a `CACHE.TILE_QUANT_DEG` grid and answers from the Workers Cache API under a key of that tile and the Room's map version (the zoom is accepted but does not change the response, so it is not in the key), which every area change bumps after its commit and before its response (the broadcast follows in `waitUntil`). A write therefore moves every read that follows its response to a new key in every data center without a purge, old entries expire after `CACHE.BOUNDS_TTL_S`, a browser revalidates with a 304 from the version-and-tile `ETag`, and a Room that does not answer within `TIMEOUTS.DO_PING_MS` sends the read to the database uncached (`X-Cache: BYPASS`).

Metrics: besides Workers Logs, the Worker writes Analytics Engine datapoints to the `TELEMETRY.DATASET` dataset (`METRICS` binding, `apps/api/src/metrics.ts`), each `{ indexes: [event], blobs: [event, subject], doubles: [value] }`: `ws_open` / `ws_close` per Room socket (`blob2` the room, value 1; not paired one-to-one: sockets dropped by an eviction or a deploy write no `ws_close`, so `ws_open - ws_close` is not a live-socket count), `room_messages` (the client frames a Room received, batched per `TELEMETRY.MESSAGES_FLUSH_MS`, never one per frame), and `db_query` (one per areas request, `blob2` `areas.list`, `areas.versions` or `areas.write`, value the database time in ms, connect + query). Without the binding (a local run without one) the writes are no-ops. To read them, query the SQL API (`POST https://api.cloudflare.com/client/v4/accounts/<account id>/analytics_engine/sql` with an Analytics Read token): `SELECT blob1 AS event, blob2 AS subject, SUM(_sample_interval) AS points, SUM(_sample_interval * double1) AS total, quantileExactWeighted(0.95)(double1, _sample_interval) AS p95 FROM cgis_metrics WHERE timestamp > NOW() - INTERVAL '1' HOUR GROUP BY event, subject`.

Hyperdrive's own query cache stays off for this config ([ADR-0004](docs/adr/0004-horizontal-scaling-on-cloudflare.md); `wrangler hyperdrive update <id> --caching-disabled`, applied at deploy): it keeps results for up to 60 s and writes do not invalidate it, so a Cache API miss right after a write could store pre-write rows under the new version key.

## Security measures

- Sessions: Better Auth with email and password (scrypt hashing, D21), `httpOnly` + `SameSite=Lax` cookies (`Secure` and the `__Secure-` prefix under an https `BETTER_AUTH_URL`). Better Auth checks Origin on its own routes against `CLIENT_ORIGIN`.
- Session cookie cache (D24): Better Auth keeps a signed copy of the session in a second cookie for `AUTH.COOKIE_CACHE_MAX_AGE_S` (5 minutes), and a request carrying a valid copy is authenticated without reading the session row. Signing out on the same device clears both cookies at once; a session revoked elsewhere (another device, an admin) stays usable on a device that still holds the cookie for up to 5 minutes.
- WebSocket origin gate: `GET /ws` needs a session, then an `Origin` equal to `CLIENT_ORIGIN` (403 otherwise). Better Auth's session lookup ignores Origin, so without the gate another site could open a socket with a visitor's cookie.
- Sign-in rate limit: once deployed (https `BETTER_AUTH_URL`), Better Auth answers 429 after `AUTH.RATE_LIMIT_MAX` (10) sign-in attempts per client IP per 60 s, counted per Worker isolate; a Cloudflare WAF rate rule on `/api/auth/*` is the global limit. The production checklist (WAF rule, `/readyz` health check, logs, rollback) is in [`docs/deploy.md`](docs/deploy.md#production-hardening).
- Mutation guards: every area mutation (create, update, delete, revert) mounts `mutationGuards()`, in this order: a session (401), one action from the user's budget (429), and the body cap `LIMITS.BODY_MAX_BYTES` (413) before anything parses the body; then validation (422). Rejected attempts therefore spend budget too.
- Rate limit (D5): one exact per-user sliding window in the `RateLimiter` Durable Object, 50 actions per 60 s (`RATE_LIMIT`), shared by REST mutations and draft sessions on the socket (one action when a draft starts, not per `draft:update` frame; see Known limitations). Over it the API answers 429 with `Retry-After` and the Room answers `error RATE_LIMITED` with `retryAfter`. A limiter failure fails closed. Each socket also has a fixed one-second window of `WS.DRAFT_RATE_PER_SEC` (10) frames in the Room.
- Audit trail (D20): one `audit_log` row per action with user, IP (`cf-connecting-ip`), user agent and request id: area create, update, delete and revert (in the same transaction as the write, pointing at the version row), sign-in, failed sign-in, sign-up and sign-out, every 422 and 429 under `/api`, each saved draft (a `draw.session` row with its vertex count, in the create's transaction), and each retention purge run. Details are redacted like logs.
- Timeouts: a 10 s budget per request (`TIMEOUTS.REQUEST_MS`, 504 `TIMEOUT`) whose abort ends the request's open database clients; each connect and query has its own 3 s limit. The `enable_request_signal` compatibility flag is on, so the runtime also aborts that signal when the client disconnects; neither `wrangler dev` nor the test pool forwards a client's disconnect, so that path is unverified locally (a disconnected `/readyz` under `wrangler dev` ran to its 3 s query limit).
- Input: every body, query and path parameter is parsed with the shared Zod schemas (422 `UNPROCESSABLE` with the issues), and PostGIS validates every polygon (`ST_IsValidReason` in a 422). All SQL values are bound parameters.
- Responses: CORS allows `CLIENT_ORIGIN` only, Hono's secure headers on every response, a 10 s request budget (504), a fresh server-generated request id on every response and log line, secrets redacted from logs (`LOG.REDACT_KEYS`), and fixed `ApiError` bodies for 404/500/503 that never echo internal errors.
- Repository: no secrets committed; the local database listens on 127.0.0.1 only.

## Known limitations

- govmap imagery rests on the legacy ITM tile caches on `cdn.govmap.gov.il`, which answer without a referrer check but are no longer updated (newest tiles from 2024-01). The current EPSG:3857 endpoint is locked to govmap's own referrer and unusable without a proxy, which D3 rules out. govmap could retire the legacy caches without notice; the aerial layer would then go blank, with no fallback imagery (D3).
- Switching base layers maps each zoom to the nearest resolution of the other grid, so a round trip is not always the identity: z15 → L07 → z16, and z0–z8 (the default view is z8) → L00 → z7; z9–z14 and z16–z19 come back unchanged (`apps/web/src/lib/geo/layer-switch.ts`).
- Better Auth's scrypt hashing needs more CPU than the Workers Free plan allows: deploying needs Workers Paid (D21).
- A session revoked on another device keeps working for up to 5 minutes where its cookie cache is still valid (D24).
- One map room (D11). Missed-update gap: an area event that lands between a viewport's first GET and the socket's first join is picked up on the next pan or reconnect; a socket that is down misses events until it rejoins (the client polls every `WS.OFFLINE_POLL_MS` while degraded or offline and resyncs on reconnect).
- Draft budget (D5, owner ruling 2026-10-13): one draft session, not each `draft:update` frame, spends one action from the same 50 per minute as REST saves. A session runs from the `add` that starts a draft to its save or the idle sweep (60 s without an edit); a resync replay, a cancel and redraw, or a reconnect inside it spends nothing, so only the per-socket 10 frames per second limits frames. A user with several tabs gets 10 frames per second per tab, and a sketch cancelled and redrawn without a save stays one session until the sweep. If the save's broadcast does not reach the Room, the session ends at the sweep instead.
- A read that overlaps a write (between its commit and its version bump) can be served the tile without that write; the bump retires that cache entry before the write's response.
- The local database listens on port 5433 (not 5432, to avoid a local Postgres), bound to 127.0.0.1 only; on a machine where that port is taken, run the same container on another port and set `CGIS_LOCAL_DB` (base URL without a database), `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` and `DATABASE_URL` to it; local PostGIS is the community multi-arch `imresamu/postgis:18-3.6` image.
- Soft-deleted areas are purged after 7 days by a daily cron (`RETENTION.DAYS`, `RETENTION.CRON`), with their version history; until then they stay in the database, invisible to the map.

## Future improvements and scaling

See [ADR-0004: Horizontal scaling on Cloudflare](docs/adr/0004-horizontal-scaling-on-cloudflare.md) (ticket 4.9): where state lives, platform limits, and the growth path (tile-sharded rooms, Queues, metrics export, multi-region).

## Testing approach

- Unit and component tests (Vitest) in all three packages; the api's run in workerd (`@cloudflare/vitest-plugin`) against the local PostGIS, Durable Objects included, and its migrations and seed in a Node project.
- API contract: `apps/api/batch/areas.jsonl` through `hono batch` on workerd. The OpenAPI document is validated in a test (`@readme/openapi-parser`) and served at `/openapi.json`; `/docs` is a hand-written page that renders it with Scalar's pinned standalone build, loaded with Subresource Integrity.
- End to end: Playwright, two browser contexts on one map against `wrangler dev` and Vite (`pnpm e2e`, [`apps/web/e2e/README.md`](apps/web/e2e/README.md)); the govmap layer-switch specs need the internet and run locally only.
- CI (`.github/workflows/ci.yml`) on every pull request and push to `main`: lint, format check, `constants:docs --check`, typecheck (the e2e specs included), `drizzle-kit generate` with no change to `apps/api/drizzle` (migrations match the schema), tests with a PostGIS service, the contract batch, web and Storybook builds and the production `wrangler deploy --dry-run`; a second job runs the e2e. Load tests (`pnpm bench`, k6) stay manual.

Test databases are per lane: every api test database is named `<base>_<lane>` (`cgis_auth_<lane>`, `cgis_api_<lane>`, `cgis_db_<lane>`, ...), where the lane is `CGIS_TEST_LANE` or, unset, the current git branch (`m2/integration` → `cgis_api_m2_integration`). Worktrees on different branches share the one compose PostGIS without resetting each other's databases; set `CGIS_TEST_LANE` to run two checkouts of one branch side by side (`apps/api/test/lane.ts`).
