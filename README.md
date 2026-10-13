# Collaborative GIS

Draw and analyse areas on a map together, in real time. Several people edit the same map; each sees the others' drafts and cursors as they happen. Base layers are OpenStreetMap and govmap aerial imagery. Every area keeps its version history and can be reverted.

Stack: Cloudflare Workers + Durable Objects, Hono, Neon PostGIS via Hyperdrive (Cloudflare's connection pooler for Postgres), React + Leaflet with TanStack Router and Query.

- Reviewer guide: [`apps/web/public/guide/index.html`](apps/web/public/guide/index.html), served by the app at `/guide/`. Screenshots, numbers and file pointers per requirement of the product brief.
- API reference: `/docs` on a running instance (OpenAPI 3.1, rendered with Scalar).

## Try it (2 minutes)

On a running instance, local or deployed:

1. Register: name, email, a password of 8 characters or more. You land on the map, signed in.
2. Draw: press the polygon button and click vertices. The panel shows the area in km² as you go.
3. Open a second window (private window or another profile) with a second account. The first user's draft appears there as a dashed ghost, and the presence list says who is drawing.
4. Save: finish the shape and name it. Both windows get the saved polygon; the server measures it with PostGIS.
5. Rename it, then open its history and revert to version 1. Reverting creates a new version; nothing is deleted.
6. Switch to aerial imagery. The polygon stays on the same ground. govmap has no imagery over the sea, which renders black.

If something looks wrong, `GET /readyz` reports the database, the Room and the configuration.

## Run it locally

Prerequisites: Node 26 (`.node-version`), pnpm 12.5 (`packageManager` in `package.json`), Docker with Compose v2. Wrangler and the Hono CLI are dev dependencies: pnpm installs them, nothing global.

```bash
pnpm install
pnpm db:up && pnpm db:check                             # PostGIS 18 / 3.6 on 127.0.0.1:5433
DATABASE_URL=postgresql://cgis:cgis@127.0.0.1:5433/cgis pnpm --filter @cgis/api db:migrate
cp apps/api/.dev.vars.example apps/api/.dev.vars        # then set BETTER_AUTH_SECRET (openssl rand -base64 32)
pnpm typecheck                                          # also generates the Worker's binding types
pnpm dev                                                # API on :8787, SPA on :5173
```

Open http://localhost:5173 and register. Vite proxies `/api` and `/ws` to the Worker, so both share one origin. `.env.example` documents the remaining variables (local and Neon). Stop the database with `pnpm db:down`.

### API in a container

Without Node for the API: `docker compose --profile api up` builds the Worker image, migrates the compose database and runs `wrangler dev` on :8787. It still needs `apps/api/.dev.vars` with `BETTER_AUTH_SECRET` set. The SPA stays on the host: `pnpm install` then `pnpm --filter @cgis/web dev`.

Other setups (a taken port, a separate database per checkout, Neon, the production config on your machine, the Hono CLI without a dev server): [`docs/local-setup.md`](docs/local-setup.md). Migrations, seeding and the database access rules: [`docs/database.md`](docs/database.md).

## How it is built

One Cloudflare Worker serves the built SPA, the REST API and the WebSocket on one origin. A `Room` Durable Object (a single-threaded object Cloudflare keeps alive with its state) per map holds every socket, presence and live drafts, and fans out each change. A `RateLimiter` Durable Object per user holds the drawing budget. PostGIS on Neon stores areas, versions, audit rows and auth tables; the Worker reaches it through Hyperdrive. Viewport reads come from the Workers Cache under a key stamped with the map's version, so a write retires every cached tile without a purge.

```mermaid
flowchart LR
  B["Browser: React + Leaflet SPA"]
  subgraph CF["Cloudflare: one Worker, one origin"]
    W["Worker: Hono API, auth, static assets"]
    R["Room DO: presence, drafts, fan-out"]
    L["RateLimiter DO: per-user budget"]
    C[("Workers Cache: viewport tiles")]
    H["Hyperdrive"]
  end
  N[("Neon PostGIS: areas, versions, audit, auth")]
  B -- "HTTPS /api" --> W
  B -- "WebSocket /ws" --> W
  W -- "upgrade, map version, broadcast" --> R
  W -- "one action per mutation" --> L
  R -- "one action per draft session" --> L
  W -- "GET /api/areas by tile + version" --> C
  W --> H --> N
```

Workspace: `packages/shared` (Zod 4 contracts and every tunable constant, documented in [`docs/constants.md`](docs/constants.md)), `apps/api` (the Hono 4 Worker), `apps/web` (Vite 8 + React 19 + TanStack Router/Query + Leaflet 1.9.4, and its Storybook).

Architecture decision records: [Cloudflare Workers + Durable Objects instead of Vercel](docs/adr/0001-cloudflare-over-vercel.md), [Hono instead of Fastify](docs/adr/0002-hono-over-fastify.md), [Leaflet 1.9.4 and an EPSG:2039 CRS](docs/adr/0003-leaflet-1-9-4-and-proj4-crs.md), [Horizontal scaling on Cloudflare](docs/adr/0004-horizontal-scaling-on-cloudflare.md), [govmap aerial imagery through a CRS swap](docs/adr/0005-govmap-crs-swap.md). ADR-0003 is superseded by ADR-0005. The full decision log is §10 of the [design spec](docs/superpowers/specs/2026-10-12-collaborative-gis-design.md).

## Technical decisions

- Cloudflare Workers + Durable Objects, not Vercel: Vercel caps every WebSocket at the function duration and needs Redis for fan-out ([ADR-0001](docs/adr/0001-cloudflare-over-vercel.md)).
- Hono, not Fastify: Workers run fetch handlers, and Hono brings Zod validation, OpenAPI and a typed client ([ADR-0002](docs/adr/0002-hono-over-fastify.md)).
- One `Room` Durable Object per map: one coordinator, so no pub/sub, no sticky sessions, no broker ([ADR-0004](docs/adr/0004-horizontal-scaling-on-cloudflare.md)).
- The realtime protocol (presence, drafts, fan-out) is this repository's own code; the product brief rules out collaboration SDKs such as Yjs, partyserver or Liveblocks.
- Drawing adapts `leaflet-editable` 1.3.2; client-side area and self-intersection use `@turf/area` and `@turf/kinks`. Map drawing is not a collaborative feature, and PostGIS stays the authority (`ST_IsValid`, `ST_Area`).
- Leaflet 1.9.4 with Proj4Leaflet: the aerial layer swaps the map's CRS to EPSG:2039 for govmap's legacy tile grid; no proxy, no fallback imagery ([ADR-0005](docs/adr/0005-govmap-crs-swap.md)).
- Optimistic concurrency: an edit carries the version it started from; a stale one gets 409 with the stored area and the user decides.
- Viewport cache keyed by tile and map version instead of purging: `cache.delete` reaches one data center, a version bump reaches all ([ADR-0004](docs/adr/0004-horizontal-scaling-on-cloudflare.md)).
- Exact per-user rate limit in a Durable Object, not the Workers rate-limit binding, which is per location and approximate.
- Audit row in the same transaction as each area write, so no write goes unrecorded.
- Drizzle query builder for every read and write; raw `sql` only for PostGIS fragments and the atomic write CTEs ([`docs/database.md`](docs/database.md)).
- Better Auth with email and password: scrypt hashing, which needs the Workers Paid plan.
- Every tunable value lives in `packages/shared/src/constants/` with a doc comment; [`docs/constants.md`](docs/constants.md) is generated from it and CI fails when it is stale.

## Performance

- Spatial index: a partial GiST index on `areas.geom` over live rows. Geodesic area is computed once per write (`ST_Area(geography)`) and stored, so reads never compute it.
- Viewport cache: `GET /api/areas` snaps the bbox outward to a 0.1° grid and answers from the Workers Cache under a key of that tile and the map version. Each write bumps the version before it responds, so the next read in every data center misses. Entries expire after 30 s; browsers revalidate with a 304 from the `ETag`.
- Bounded payloads: at most 500 areas per viewport response, 200 versions per history page, 64 KiB per mutation body. The 500 cap has no paging and no truncation flag (see [Known limitations](#known-limitations)).
- Draft budget: a draft session spends one action of the user's 50 per minute, not each frame; frames are capped at 10 per second per socket in the Room.
- Hyperdrive's own query cache is off: writes do not invalidate it.

Measured ([`docs/benchmarks.md`](docs/benchmarks.md), [`docs/benchmarks-load.md`](docs/benchmarks-load.md); k6 runs locally against `wrangler dev`, not in CI):

| Measurement                          | Load                                               | Result                                                               |
| ------------------------------------ | -------------------------------------------------- | -------------------------------------------------------------------- |
| Bounds query, GiST index             | 10,000 areas, 20 runs                              | p50 0.17 ms, p95 0.22 ms (index scans off: p50 1.18 ms, p95 1.33 ms) |
| REST, `pnpm bench` (`bench/rest.js`) | 10 users, 1 min: 1,600 viewport reads, 400 creates | read p95 86 ms, write p95 132 ms, 0 errors, 0 429                    |
| WebSocket (`bench/ws.js`)            | 5 sockets, 10 draft frames/s each, 30 s            | 6,000 of 6,000 frames reached every peer within 1 s; delay p95 8 ms  |

## Security

- Sessions: Better Auth, email and password, scrypt hashing. Cookies are `httpOnly`, `SameSite=Lax`, and `Secure` with the `__Secure-` prefix under https. A signed cookie copy of the session is valid for 5 minutes, so a session revoked elsewhere can outlive the revocation by that long. Signing out on the same device clears both cookies at once.
- WebSocket origin gate: `GET /ws` needs a session and an `Origin` equal to `CLIENT_ORIGIN`; anything else is 403.
- CORS allows `CLIENT_ORIGIN` only. Hono's secure headers are on every response.
- Validation: every body, query and path parameter is parsed with the shared Zod schemas (422 with the issues); PostGIS validates every polygon (`ST_IsValidReason`). All SQL values are bound parameters.
- Rate limit: 50 drawing actions per user per 60 s, counted in the `RateLimiter` Durable Object. An action is one REST mutation (create, update, delete, revert) or one draft session on the socket; a rejected mutation spends budget too. Over the limit: 429 with `Retry-After`, or an `error RATE_LIMITED` frame. A limiter failure fails closed. Sign-in is limited to 10 attempts per IP per minute per isolate (deployed only, under https); a WAF rule is the global limit ([`docs/deploy.md`](docs/deploy.md#production-hardening)).
- Mutation guards run in order: session (401), budget (429), body size (413), then validation (422).
- Timeouts: 10 s per request (504), and 3 s per database connect and per query; an abort ends the request's open database clients. A client disconnect also aborts the request (`enable_request_signal`), but `wrangler dev` and the tests never forward a disconnect, so that path is untested locally.
- Audit log: one row per action with user, IP, user agent and request id. Recorded: area create, update, delete and revert (in the write's transaction), each saved draft, sign-in, failed sign-in, sign-up, sign-out, every 422 and 429, and each retention purge.
- Secrets: none in the repository; `BETTER_AUTH_SECRET` is a Worker secret, the Neon API key is injected per command from 1Password, and log lines are redacted. Error bodies for 404, 500 and 503 never echo internals. The local database listens on 127.0.0.1 only.

## Observability

- `GET /healthz` is liveness. `GET /readyz` pings the database and the Room and checks the origin configuration; it answers 200 `{ status: ready, db, room, config }` or 503 naming what is down.
- Workers Logs: structured JSON lines with a request id on every response and log line; live with `wrangler tail --env production`.
- Analytics Engine datapoints (`METRICS` binding, no-op locally), written by `apps/api/src/metrics.ts` to the `cgis_metrics` dataset (`TELEMETRY.DATASET`). Events: `ws_open` and `ws_close` per Room socket (not a live count: evicted sockets write no close), `room_messages` (client frames per Room, batched), and `db_query` (database time in ms per areas request, by `areas.list`, `areas.versions` or `areas.write`).
- To query them, POST SQL to `https://api.cloudflare.com/client/v4/accounts/<account id>/analytics_engine/sql` with an Analytics Read API token:

```sql
SELECT blob1 AS event, blob2 AS subject, SUM(_sample_interval) AS points,
       quantileExactWeighted(0.95)(double1, _sample_interval) AS p95
FROM cgis_metrics WHERE timestamp > NOW() - INTERVAL '1' HOUR GROUP BY event, subject
```

Health checks, WAF rule, log retention and alerts: [`docs/deploy.md`](docs/deploy.md#production-hardening).

## Known limitations

The [reviewer guide](apps/web/public/guide/index.html) counts 5 of 78 requirement lines as partial (§12). Those first, then the rest.

- A viewport read returns at most the 500 most recently updated areas of its 0.1° tile, with no paging and no truncation flag. A denser tile silently drops areas, possibly inside the viewport.
- The 10,000-polygon benchmark spread its areas over all of Israel (30 in the test viewport). A region that holds 10,000 is never served whole: no zoom simplification, clustering or paging; `zoom` is accepted and ignored.
- The Room writes no audit rows: WebSocket joins, leaves, presence changes and drafts that are never saved leave no per-user record. `audit_log` has no index and no retention.
- No message queue absorbs bursts: fan-out is a synchronous loop over every socket in the one Room. Cloudflare Queues is a documented growth step, not built.
- Docker Compose runs PostGIS and, with `--profile api`, the Worker; the SPA dev server is not containerised.
- Aerial imagery rests on govmap's legacy tile cache: newest tiles from 2024-01, no referrer check today, and govmap can retire it without notice. The aerial layer would then go blank; there is no fallback imagery.
- "No third-party plugins for the collaborative features" is read narrowly: drawing adapts `leaflet-editable`, and area and self-intersection use `@turf`. Presence, relay, fan-out and the limiter are this repository's code.
- Switching base layers maps each zoom to the nearest resolution of the other grid, so a round trip can change the zoom. Examples: z15 → L07 → z16, and z0–z8 → L00 → z7 (`apps/web/src/lib/geo/layer-switch.ts`).
- One map room for the whole app. An area event that lands between a viewport's first read and the socket's join is picked up on the next pan or reconnect. A socket that is down polls every 10 s and resyncs on reconnect.
- A read that overlaps a write (between its commit and its version bump) can be served the tile without that write. The bump retires that entry before the write's response.
- The 50-per-minute limit counts draft sessions, not frames: one tab can send 600 frames a minute under the separate 10/s cap. A session runs from its first edit to the save or the 60 s idle sweep; a resync replay, a reconnect, or a cancel and redraw inside it spends nothing. If the save's broadcast misses the Room, the session ends at the sweep instead.
- Load was measured locally at 10 REST users and 5 sockets, never against production. Cross-region Room placement is untested; the Room lives near its first user.
- Deploying needs Workers Paid (scrypt CPU). A revoked session stays usable for up to 5 minutes where its cookie cache is valid.
- Soft-deleted areas and their history are purged after 7 days by a daily cron; until then they stay in the database, invisible to the map.

## Future improvements and scaling

From [ADR-0004](docs/adr/0004-horizontal-scaling-on-cloudflare.md) and the [roadmap](docs/roadmap.md). Each step is triggered by a measurement, not a date.

- Shard rooms by tile when one Room's throughput or fan-out CPU is the ceiling: a socket per visible tile, a per-shard version counter, and the same cache key scheme.
- Paging or a truncation flag for dense tiles, and simplified geometry at low zoom (`ST_SimplifyPreserveTopology`), so a region of 10,000 areas can be served whole.
- Cloudflare Queues for audit batching and burst smoothing; audit rows from the Room for WebSocket actions.
- OpenTelemetry export of traces and logs (a wrangler config change), and product metrics dashboards over the Analytics Engine dataset.
- Multi-region: location hints per map and, for the database, a second Neon project with logical replication.
- Neon read replicas behind a read binding on GET routes once read volume warrants it.
- A Neon branch and preview URL per pull request.
- The Workers rate-limit binding as an edge pre-filter in front of the exact limiter.

## Testing

| Kind                    | Where                                                                                      | Count                | Run                                           |
| ----------------------- | ------------------------------------------------------------------------------------------ | -------------------- | --------------------------------------------- |
| Unit, shared contracts  | `packages/shared`                                                                          | 4 files, 42 tests    | `pnpm --filter @cgis/shared test`             |
| Unit + integration, API | `apps/api/test` (workerd, the Workers runtime, run locally; Durable Objects, real PostGIS) | 40 files, 348 tests  | `pnpm --filter @cgis/api test`                |
| Unit + component, web   | `apps/web/src` (jsdom)                                                                     | 38 files, 345 tests  | `pnpm --filter @cgis/web test`                |
| Storybook browser tests | every story: render, play, a11y in headless Chromium                                       | 14 files, 48 stories | `pnpm --filter @cgis/web test:storybook`      |
| API contract            | `apps/api/batch/areas.jsonl` through `hono batch` on workerd                               | 1 batch              | see [`docs/testing.md`](docs/testing.md)      |
| End to end              | `apps/web/e2e`, two browser contexts on one map                                            | 2 specs, 3 tests     | `pnpm e2e` ([README](apps/web/e2e/README.md)) |
| Load                    | `bench/`, k6 against `wrangler dev`                                                        | 2 scripts            | `pnpm bench` ([README](bench/README.md))      |

`pnpm test` runs the first three; their counts are vitest pass counts on f16685f. The OpenAPI document is validated in a test and served at `/openapi.json`. The aerial e2e spec needs the internet and runs locally only.

CI (`.github/workflows/ci.yml`) runs three jobs on every pull request and push to `main`. `checks` runs lint, format, constants doc and typecheck. `ci` runs migrations match the schema, tests against a PostGIS service, the contract batch, web and Storybook builds, a production `wrangler deploy --dry-run`. `e2e` runs the Storybook browser tests and Playwright.

API test databases are per lane: each is named `<base>_<lane>`, where the lane is the git branch, so worktrees on different branches share one PostGIS without resetting each other. Details, the Hono CLI commands and the day-to-day checks: [`docs/testing.md`](docs/testing.md).

## Documentation map

- [`docs/local-setup.md`](docs/local-setup.md): other local setups: ports, lane databases, the API container, Neon, the production config locally.
- [`docs/database.md`](docs/database.md): migrations, seeding, coordinate order and the database access rules.
- [`docs/testing.md`](docs/testing.md): lane databases, the Hono CLI, the checks before a push.
- [`docs/deploy.md`](docs/deploy.md): production deploy, owner checklist, smoke checks, rollback and hardening.
- [`docs/adr/`](docs/adr/): architecture decision records.
- [`docs/constants.md`](docs/constants.md): every tunable value, generated from `packages/shared/src/constants/`.
- [`docs/benchmarks.md`](docs/benchmarks.md): the bounds query with and without the GiST index.
- [`docs/benchmarks-load.md`](docs/benchmarks-load.md): k6 load results for REST and WebSocket; scripts in [`bench/README.md`](bench/README.md).
- [`docs/roadmap.md`](docs/roadmap.md): epics, tickets, milestones and the critical path.
- [`docs/research-notes.md`](docs/research-notes.md): the pre-roadmap reading per technology.
- [`docs/superpowers/specs/2026-10-12-collaborative-gis-design.md`](docs/superpowers/specs/2026-10-12-collaborative-gis-design.md): the design spec; §10 is the decision log. Milestone plans in [`docs/superpowers/plans/`](docs/superpowers/plans/).
- [`docs/process-log.md`](docs/process-log.md): how the work was done, task by task.
- [`apps/web/e2e/README.md`](apps/web/e2e/README.md): the two-browser Playwright run.

## Deploy

Every push to `main` deploys once CI is green: migrate Neon over its direct URL, build the SPA, `wrangler deploy --env production` with the origin from a repository variable. The hostname never appears in the repository.
Owner checklist, smoke checks, rollback and hardening: [`docs/deploy.md`](docs/deploy.md).
