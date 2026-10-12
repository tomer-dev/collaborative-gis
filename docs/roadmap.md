# Collaborative GIS — strategic roadmap

**Linear:** project [Collaborative GIS (Snapland)](https://linear.app/tomer-sharoni-personal/project/collaborative-gis-snapland-c2d5d7aca277) (P-TOM-1, team TOM). Epics TOM-5…TOM-12; tickets TOM-13…TOM-73 (61). Ticket numbering below (0.1, 1.1, …) is the prefix of each Linear issue title.

Source: Snapland home assignment (Team Lead). Stack: React + Vite + TanStack Router/Query + Leaflet; TypeScript Hono on Cloudflare Workers + Durable Objects (WebSocket Hibernation) ; Postgres/PostGIS on Neon via Drizzle + Hyperdrive; Better Auth; Cloudflare deploy (Worker + static assets). Research backing each choice: `docs/research-notes.md`.

## Principles
- Grouped by separation of concerns. Each epic is one lane with one owner-able skill.
- Contracts first (E0) so lanes run in parallel against shared Zod schemas; frontend mocks the API until E3 lands.
- Milestones: **M0** foundation → **M1** vertical slice → **M2** hardening → **M3** delivery → **M4** deploy (Cloudflare).
- Every ticket names the Claude skill to invoke when executing it.

## Dependency graph
```
E0 ──┬── E1 (db) ──┐
     ├── E2 (auth/security) ──┼── E3 (areas api) ──┐
     ├── E4 (realtime) ───────┘                    ├── E6 (quality) ── E7 (deploy)
     └── E5 (frontend, mocked api) ────────────────┘
```

## Epics and tickets

### E0 Foundation & Contracts — M0 — skills: typescript-pro, devops-engineer
| # | Ticket | Acceptance | Blocked by |
|---|---|---|---|
| 0.1 | Monorepo scaffold (pnpm workspaces: apps/web, apps/api (Hono Worker, `wrangler.jsonc`, `nodejs_compat`), packages/shared; tsconfig base; eslint/prettier) | `pnpm -r typecheck` passes; `wrangler dev` serves hello | — |
| 0.2 | Shared contracts package: Zod schemas for Area, AreaVersion, bounds query, API error shape, WS message envelope + event types | Types exported; schema tests for one valid and one invalid polygon | 0.1 |
| 0.3 | Local DB: docker-compose with postgis/postgis image; `.env.example`; Neon project + `CREATE EXTENSION postgis` (direct connection); Hyperdrive config with `localConnectionString` for dev | `select postgis_version()` works locally (via Hyperdrive local) and on Neon | 0.1 |
| 0.4 | CI: GitHub Actions lint + typecheck + test on PR; `wrangler deploy --dry-run` | Green on empty repo | 0.1 |
| 0.5 | Docs skeleton: README outline per submission checklist, ADR template, `docs/process-log.md` | Files exist with headings | 0.1 |

### E1 Database & Spatial — M1/M2 — skills: postgres-pro, database-optimizer, supabase-postgres-best-practices
| # | Ticket | Acceptance | Blocked by |
|---|---|---|---|
| 1.1 | Drizzle schema: `areas` (id, name, geom geometry(Polygon,4326), area_km2, version, created_by, created_at, updated_at, deleted_at), `area_versions`, `audit_log`; Better Auth tables | `drizzle-kit generate` produces migration; migration 0 enables postgis | 0.3 |
| 1.2 | Migrations workflow: `drizzle-kit generate` + migrate from CI against the Neon **direct** URL; runtime uses Hyperdrive (transaction pooling: no session state, `pg` client per request, `max` ≤ 5) | Documented in README; CI runs migrate against ephemeral DB | 1.1 |
| 1.3 | GiST index on geom + partial index `where deleted_at is null`; bounds query `geom && ST_MakeEnvelope(...)` | EXPLAIN shows index scan | 1.1 |
| 1.4 | Area calculation: `ST_Area(geom::geography)/1e6` as generated/trigger-maintained `area_km2` | Known polygon matches reference within 0.1% | 1.1 |
| 1.5 | Seed script: 10,000+ random valid polygons across Israel bounds | Seeds in < 60s | 1.1 |
| 1.6 | Soft delete + retention: `deleted_at`, purge of rows older than N days run by a Workers Cron Trigger (`scheduled` handler), versions pruned with parent | Purge is idempotent; test covers it | 1.1 |
| 1.7 | Benchmark: bounds query p95 on 10k rows with/without index, recorded in docs | Numbers in `docs/benchmarks.md` | 1.3, 1.5 |

### E2 Auth & Security — M1/M2 — skills: better-auth-best-practices, security-reviewer
| # | Ticket | Acceptance | Blocked by |
|---|---|---|---|
| 2.1 | Better Auth server: email/password, Drizzle adapter over Hyperdrive, Hono `app.all('/api/auth/*')` after `cors`, `trustedOrigins`, secure cookie attributes, `nodejs_compat` | Sign-up, sign-in, sign-out, `GET /api/auth/ok` on `wrangler dev` | 1.1 |
| 2.2 | Session guard: Hono middleware `requireUser` via `auth.api.getSession({headers})`; the Worker validates the session before forwarding the `/ws` upgrade to the room DO and passes user id/name in headers to the DO | 401 on missing cookie; WS upgrade rejected without session | 2.1 |
| 2.3 | CORS (Hono `cors`, explicit origin, credentials) + `secureHeaders` middleware | Preflight passes from web origin only | 0.1 |
| 2.4 | Input validation at the boundary with Zod (`hono-openapi` `validator`); polygon rules: ≥3 unique vertices, closed ring, lng/lat ranges, ≤1,000 vertices, no self-intersection (client pre-check, server `ST_IsValid`) | Invalid shapes return 422 with reason | 0.2 |
| 2.5 | Rate limiting: per-user `RateLimiter` Durable Object with an exact sliding window (50 drawing actions / 60 s), called from REST mutations and from the room DO for WS actions; 429 with Retry-After; optional Workers rate-limit binding as edge pre-filter (documented as eventually consistent) | Test hits 51st action → 429 | 2.2 |
| 2.6 | Timeouts: Hono `timeout` middleware + `AbortSignal` passed to DB queries; 504 on timeout; Worker CPU limits documented | Test with a stalled handler | 0.1 |
| 2.7 | Error handling + logging: `app.onError` sanitizes 5xx; structured JSON logs with request id (Workers Logs, `observability.enabled`), redaction of secrets; error shape from contracts | Unit test for handler | 0.2 |
| 2.8 | Health: `/healthz` (liveness) and `/readyz` (Hyperdrive DB ping, room DO ping) | Returns 503 when DB down | 0.3 |

### E3 Areas API — M1/M2 — skills: api-designer, typescript-pro (agent: Backend Architect)
| # | Ticket | Acceptance | Blocked by |
|---|---|---|---|
| 3.1 | `POST /areas` create: validate, insert, compute area, write version 1 + audit row, return Area | Round-trip test | 1.4, 2.2, 2.4 |
| 3.2 | `GET /areas?bbox=w,s,e,n` bounds query with limit + simplified geometry at low zoom (`ST_SimplifyPreserveTopology`) | Returns only intersecting, non-deleted areas | 1.3 |
| 3.3 | `PUT /areas/:id` with optimistic concurrency: body carries `version`; mismatch → 409 with current server copy; success bumps version + writes `area_versions` | Concurrent edit test yields one 200 and one 409 | 3.1 |
| 3.4 | `DELETE /areas/:id` soft delete + audit | Row hidden from bounds query | 3.1 |
| 3.5 | `GET /areas/:id/versions` and `POST /areas/:id/revert/:version` | History lists all versions; revert creates a new version | 3.3 |
| 3.6 | Cache layer: bounds responses keyed by quantized bbox tile in the Workers Cache API (`s-maxage`) with ETag; write path purges affected tile keys (KV index of tile → keys); hit ratio logged | Invalidation test | 3.2 |
| 3.7 | Audit log middleware: user, action, entity, ip, user-agent, payload hash for every mutation and WS action | Rows written for all mutating routes | 3.1 |
| 3.8 | OpenAPI 3.1 via `hono-openapi` (`describeRoute`, `openAPIRouteHandler`) + Scalar/Swagger UI at `/docs` | Spec validates; UI renders | 3.1–3.5 |

### E4 Realtime (Durable Objects) — M1/M2 — skills: websocket-engineer
| # | Ticket | Acceptance | Blocked by |
|---|---|---|---|
| 4.1 | `Room` Durable Object (SQLite-backed, `new_sqlite_classes` migration) using the WebSocket Hibernation API: Worker checks `Upgrade` + session, forwards to `env.ROOM.getByName(mapId)`; DO `acceptWebSocket`, `serializeAttachment({userId,name,color})`, `setWebSocketAutoResponse(ping→pong)` | Authed client connects; unauthed gets 401; DO hibernates when idle | 0.2, 2.2 |
| 4.2 | Protocol handlers in `webSocketMessage` per contracts: `join`, `leave`, `presence`, `draft:update`, `area:created/updated/deleted`, `error` | Schema-validated in and out; unknown type → error frame | 4.1 |
| 4.3 | Presence: derived from `ctx.getWebSockets()` attachments (survives hibernation); state viewing/drawing; join/leave broadcast; stale-draft cleanup via DO alarm | Two clients see each other | 4.2 |
| 4.4 | Draft drawing broadcast: throttle per-sender to ≤10 msg/s, only deltas (vertex add/move), drop stale frames by seq | Bandwidth test under 10 users | 4.2 |
| 4.5 | Persistence fan-out: after a REST mutation the Worker calls the room DO (RPC method `broadcast`) with the `area:*` event; DO is the single coordinator so no external pub/sub is needed | Second client receives event on save | 3.1, 4.2 |
| 4.6 | Heartbeat + reaping: client ping every 30 s answered by auto-response; `webSocketClose/Error` remove presence; alarm sweeps sockets with no recent activity | Killed client disappears within 60 s | 4.3 |
| 4.7 | Graceful degradation (client+server): reconnect with exponential backoff + jitter, resync via `GET /areas?bbox` on reconnect, polling fallback every 10s when WS unavailable, UI state banner | Chaos test: kill server, client recovers | 4.5 |
| 4.8 | Rate limit WS drawing actions: room DO calls the per-user `RateLimiter` DO (shared 50/min budget with REST) | 51st action → error frame | 2.5, 4.4 |
| 4.9 | ADR: horizontal scaling on Cloudflare — one DO per room is the coordinator (soft limit ≈1,000 req/s/object), shard rooms by map tile for growth, Workers Queues for burst smoothing of audit writes, DO hibernation cost model; why not Vercel (WS beta + duration cap) | ADR committed | 4.5 |

### E5 Frontend Map — M1/M2 — skills: react-expert, frontend-design, vercel-react-best-practices, web-design-guidelines
| # | Ticket | Acceptance | Blocked by |
|---|---|---|---|
| 5.1 | Vite + React + TanStack Router (file routes) + TanStack Query scaffold; auth context in router; protected `/map` route | Redirect to `/login` when signed out | 0.2 |
| 5.2 | Auth pages: register, login, logout using Better Auth client | Session persists on reload | 5.1, 2.1 |
| 5.3 | Leaflet map with OSM base layer, attribution, Israel default view | Renders, pans, zooms | 5.1 |
| 5.4 | **Spike**: govmap aerial tiles — decode cache/level/row/col scheme, define EPSG:2039 `L.Proj.CRS`, compare (A) CRS swap per base layer, (B) reprojecting tile proxy, (C) fallback 3857 imagery; check licence | Written recommendation + prototype branch; time-box 1 day | 5.3 |
| 5.5 | Satellite layer per spike outcome; coordinate transforms isolated in `lib/projection.ts` with unit tests (ITM↔WGS84 known points) | Tel Aviv control point within 1 m | 5.4 |
| 5.6 | Layer switch: crossfade via opacity tween, preserve center/zoom equivalence across CRS, re-add overlays from WGS84 state, no flicker | Drawn polygon stays on the same ground features after toggle | 5.5 |
| 5.7 | Hand-rolled polygon draw tool (no plugin): click to add vertex, drag handles, double-click/Enter to close, Esc to cancel, keyboard accessible, works on both base layers | Produces a valid closed ring | 5.3 |
| 5.8 | Live area readout while drawing (client geodesic formula, e.g. Karney/spherical excess) and server-authoritative value after save | Client vs server differ < 0.5% | 5.7 |
| 5.9 | Areas data layer: TanStack Query `['areas', bbox]`, debounced `moveend` refetch, render polygons, select to edit, optimistic save with rollback on 409 + conflict dialog | Conflict dialog shows server copy | 5.7, 3.3 |
| 5.10 | WS client hook: connection state machine, presence list UI, remote ghost polygons with user colors, event → query cache patches | Two browsers see each other draw | 4.7, 5.9 |
| 5.11 | Area panel: list in view, rename, history + revert | Revert updates map | 3.5, 5.9 |
| 5.12 | UX polish + a11y pass (web-design-guidelines), responsive layout, error/empty/loading states | Audit checklist passes | 5.9–5.11 |

### E6 Quality & Delivery — M3 — skills: test-master, playwright-expert, code-documenter
| # | Ticket | Acceptance | Blocked by |
|---|---|---|---|
| 6.1 | Unit tests: area calc, polygon validation, rate limiter, conflict resolution, projection utils | Vitest green in CI | E1–E5 |
| 6.2 | Integration tests: `@cloudflare/vitest-pool-workers` for Worker + DO (WS protocol tests), ephemeral PostGIS via compose | Green in CI | 6.1 |
| 6.3 | E2E: Playwright two-browser collaborative scenario | Passes locally | 5.10 |
| 6.4 | Local parity: docker-compose (postgis) + `wrangler dev` with Hyperdrive `localConnectionString` + Dockerfile running the Hono app on Node (`@hono/node-server`, `@hono/node-ws`) for the bonus docker-compose requirement | `docker compose up` serves the app | E1–E5 |
| 6.5 | README: setup, architecture, decisions, performance, security, limitations, future work, testing approach; ADRs linked | Matches submission checklist | all |
| 6.6 | Load test: k6 WS + REST scenario, results in `docs/benchmarks.md` | Numbers recorded | 6.4 |
| 6.7 | Telemetry: Workers Logs + Workers Analytics Engine datapoints (ws connections, msgs/s, query latency); `/metrics` counters from the room DO; OpenTelemetry as design note | Endpoint returns counters | 2.7 |

### E7 Deployment (Cloudflare) — M4 — skills: devops-engineer, cloud-architect
| # | Ticket | Acceptance | Blocked by |
|---|---|---|---|
| 7.1 | Single Worker deploy: Hono API + `Room`/`RateLimiter` DOs + Vite SPA as static assets (`not_found_handling: single-page-application`, `run_worker_first: ["/api/*", "/ws"]`) via `@cloudflare/vite-plugin`; `wrangler deploy` from CI | Production URL serves app, API, WS | 6.4 |
| 7.2 | Hyperdrive config pointing at Neon (pooled-compatible), secrets via `wrangler secret put` (`DATABASE_URL` direct for migrations in CI only, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `CLIENT_ORIGIN`); env separation with wrangler environments | Deploy succeeds with no secrets in repo | 7.1 |
| 7.3 | Preview flow: Neon branch per PR (Neon CLI/GitHub Action) + `wrangler versions upload` preview URL; migrations run in CI against the branch | PR preview has its own DB | 7.2 |
| 7.4 | Durable Object migrations + observability: `migrations` tags in wrangler config, `observability.enabled`, Workers Logs retention, DO hibernation verified in logs | Two clients on different edge locations see each other's events | 4.9, 7.1 |
| 7.5 | Production hardening: `trustedOrigins`, secure cookies, Cloudflare WAF rate rules on `/api/auth/*`, health checks wired to a Cloudflare Health Check, rollback via `wrangler rollback` documented | Checklist in README | 7.4 |

## Known risks (facts only, no critique)
- govmap imagery licence and tile scheme are undocumented; spike 5.4 is on the critical path for section 4 of the brief.
- Durable Objects: one object per room is a single-threaded coordinator (≈1,000 req/s soft limit); hibernation resets in-memory state, so all presence must live in attachments or storage.
- Hyperdrive and Neon pooling are both transaction mode; session-level SQL and migrations must use the Neon direct URL.
