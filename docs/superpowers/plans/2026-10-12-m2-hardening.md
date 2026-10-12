# M2 Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Same execution model as M1: lanes and waves, one isolated worktree per implementer (`Agent` tool `isolation: worktree`), stacked PRs (base = parent branch), only the user merges to main, one fable review per epic at the end of M2. Git as `/usr/bin/git -C "<worktree>" <one subcommand>`. No hardcoded values: constants in `packages/shared/src/constants.ts` + `docs/constants.md`. Every unit of work has a Linear ticket before dispatch.

**Goal:** Turn the M1 vertical slice into the brief's full feature set: govmap aerial layer with a correct CRS swap, exact rate limiting on REST and WS, cache layer with version-stamped keys, versions + revert, audit trail, retention purge, graceful degradation, OpenAPI docs, 10k-polygon seed with index proof, plus the area panel — on a deployed URL (M1 ends with 7.1/7.2).

**Spec:** `docs/superpowers/specs/2026-10-12-collaborative-gis-design.md` (§5 layer switch, viewport fetch, degradation; §6; §10 D3–D8, D13). **Research:** `.superpowers/sdd/2026-10-12-m1-vertical-slice/research-govmap-spike.md` (tile scheme, EPSG:2039, CRS swap recipe, control points, fixtures), `research-better-auth-spike.md`, ADR-0004 (Hyperdrive caching disabled). **Decisions 2026-10-12:** simplification skipped; telemetry/compose-workerd/UX-polish/preview-branches/Storybook-CI deferred to E8 (M5); full cache, revert, benchmarks+k6 (M3), E2E (M3), hardening (M4) kept.

**Tech additions (verify with `npm view` at dispatch):** proj4 2.22.x + @types/proj4 2.19.x + proj4leaflet 1.0.2 (web; D22: Proj4Leaflet wraps the CRS, verified it still targets the Leaflet 1.x CRS interface); `@scalar/hono-api-reference` or Swagger UI via hono-openapi (api); nothing else new.

**Base:** `main` after the M1 integration (T16) and deploy (7.1/7.2) PRs merge.

## Global Constraints (in addition to M1's)
- D3: option A only — swap the map CRS to EPSG:2039 for govmap; no proxy, no fallback imagery; legacy cache `B0BZ1ORTO23` (fallback caches `M2023ORT3TS`, `020522B0B20R` as a constant list, tried in order only at tile-layer construction, never at runtime); `crossOrigin` off (CDN sends no CORS headers); lowercase 8-digit hex rows/cols.
- Rate limit: `RATE_LIMIT.DRAW_ACTIONS_PER_WINDOW = 50` per `RATE_LIMIT.WINDOW_MS = 60_000`, one `RateLimiter` DO per user shared by REST mutations and WS draft actions; 429 + `Retry-After` on REST, `error RATE_LIMITED` with `retryAfter` on WS.
- Cache: Workers Cache API keyed by `(quantized tile, zoom, mapVersion)`; `mapVersion` bumped by the Room DO on every write and read via DO RPC `getVersion()`; `s-maxage` = `CACHE.BOUNDS_TTL_S`; ETag; Hyperdrive config caching disabled (ADR-0004; 7.2 applies it).
- Retention: soft-deleted areas purged after `RETENTION.DAYS = 7` (D8) by a Cron Trigger `scheduled` handler; versions pruned with the parent; idempotent.
- Audit (D20): one row per user action (mutations, auth events, WS draw sessions, rejections); ip (`cf-connecting-ip`), user agent; area events reference `(entity_id, version)`, no payload hash.

## Review Focus
1. Toggle to govmap after panning/zooming: centre stays within 1 px and a drawn polygon stays on the same ground features (headless Chromium test with the research fixtures; pitfalls: inherited `wrapLng`, zoom index mapping).
2. 51st drawing action within 60 s over REST and over WS, mixed, is rejected; the 52nd after the window refills succeeds.
3. Write → next bounds read is fresh even when a cached entry existed for that tile (version key changes); an old-version entry is never served.
4. Purge is idempotent and never deletes a non-deleted area or the versions of a live area.
5. WS down: client shows the banner, polls every 10 s, keeps drafts locally, resyncs on reconnect without duplicate polygons.

## Lanes, waves, ownership

| Wave | db lane | api lane | realtime lane | web lane |
|---|---|---|---|---|
| 1 | H1 seed 10k + EXPLAIN proof (1.5, 1.3) · H2 retention purge cron (1.6) | H3 versions + revert endpoints (3.5) · H4 audit middleware (3.7) · H5 REST rate-limit mount + timeouts/AbortSignal (2.5 REST half, 2.6) | H6 WS rate limit via RateLimiter + heartbeat/reaping (4.8, 4.6) · H7 `getVersion()`/`bumpVersion()` RPC + readyz DO ping (3.6 half, 2.8) | H8 projection + govmap CRS/tile layer (5.4 spike, 5.5) |
| 2 | — | H9 cache layer (3.6, needs H7) · H10 OpenAPI docs UI (3.8) | H11 degradation hardening + chaos test (4.7) | H12 layer switch control + crossfade (5.6, needs H8) · H13 area panel: list, rename, history, revert (5.11, needs H3) · H14 client degradation UI (4.7 client half, with H11) |
| 3 | **H15 integration + process log + M2 epic review** (single) | | | |

Ownership follows M1's table; new exclusive files: db `apps/api/src/db/{seed.ts,purge.ts}`, `apps/api/src/scheduled.ts`; api `apps/api/src/routes/{versions.ts,docs.ts}`, `src/middleware/{audit.ts,rate-limit mount}`, `src/cache/**`; realtime `src/do/room.ts` additions only; web `src/lib/geo/{projection.ts,govmap-crs.ts,govmap-layer.ts}`, `src/components/{LayerSwitch,AreaPanel,ConnectionBanner,…}.tsx`. Shared files (`app.ts`, `index.ts` for `scheduled`, `wrangler.jsonc` for `triggers.crons`, `package.json`) are edited only by H15 or by explicit additive exceptions named in each brief.

## Tasks (interface level; briefs carry exact values from constants and the research notes)

### H1 (db): seed + index proof — TOM-22 (1.5), TOM-20 (1.3 proof)
`apps/api/src/db/seed.ts` + script `pnpm --filter @cgis/api db:seed [--count 10000]`: random valid polygons (4–12 vertices, 0.2–3 km across) inside Israel bounds `SEED.BBOX`, inserted in batches of `SEED.BATCH` with `ST_GeomFromGeoJSON`, area via `ST_Area(geog)/1e6`, version 1 rows; idempotent by a `seed` tag in `name`. Test: seeds 1,000 in < 10 s locally; bounds query `EXPLAIN (ANALYZE, FORMAT JSON)` on 10k shows the GiST index node and p95 < `BENCH.BOUNDS_P95_MS` (recorded, not asserted hard); `docs/benchmarks.md` gets the first table (with/without index via `SET enable_indexscan`).

### H2 (db): retention purge — TOM-23 (1.6)
`apps/api/src/db/purge.ts` `purgeDeleted(client, now, days = RETENTION.DAYS)` → deletes `areas` with `deleted_at < now - days` and their `area_versions` in one transaction, returns counts; `apps/api/src/scheduled.ts` `scheduled` handler calling it via `withClient` and logging a JSON line; `wrangler.jsonc` `triggers.crons: [RETENTION.CRON]` (**exception**) and `index.ts` export (**exception**). Tests: purge removes only rows older than the cutoff; second run deletes 0; `scheduled` invoked via `cloudflare:test` runs without error.

### H3 (api): versions + revert — TOM-58 (3.5)
`GET /api/areas/:id/versions` → `{ versions: AreaVersion[] }` newest first; `POST /api/areas/:id/revert/:version` → creates a NEW version from the old row (geometry, name), bumps `version`, audit `area.revert`, fan-out `area:updated`, 404 for unknown, 409 if the area is deleted. Tests: three edits → three versions; revert to 1 → version 4 with v1 geometry.

### H4 (api): audit middleware — TOM-60 (3.7)
`audit(action)` middleware writing one `audit_log` row after a successful mutation (user, action, entity, entity id and version from the response, ip from `cf-connecting-ip`, user agent; D20: no payload hash) plus rows for sign-in/sign-out/failed sign-in, 422/429 rejections; mounted by H15 on create/update/delete/revert; the Room DO writes one `draw.session` row per completed draft via a small RPC to the Worker (or direct `withClient` in the DO — brief chooses after checking DO→Hyperdrive access; research says DOs can use bindings). Tests: a create writes a row whose `(entity_id, version)` matches the new version row; a 422 writes a rejection row with no entity id.

### H5 (api): REST rate limit + AbortSignal timeouts — TOM-29 (REST half), TOM-30 (2.6)
Mount `rateLimit('draw')` on POST/PUT/DELETE/revert (H15 wires; H5 ships the composition helper + tests); pass `c.req.raw.signal` / the timeout's `AbortSignal` into `withClient` so a timed-out request ends its DB client; test: a stalled query (pg `pg_sleep`) → 504 and the client is ended.

### H6 (realtime): WS rate limit + reaping — TOM-40 (4.8), TOM-38 (4.6)
In `webSocketMessage` for `draft:update`: after the 10/s bucket, call `env.RATE_LIMITER.get(idFromName(userId)).take('draw')`; on refusal send `error RATE_LIMITED { retryAfter }`. Reaping: attachment `lastSeen` updated on every frame; `alarm()` closes sockets idle > `WS.PRESENCE_IDLE_MS` with code `WS.CLOSE_IDLE` and broadcasts `presence`. Tests: 51st draft action in the window → error; idle socket reaped within the alarm period (fake time).

### H7 (realtime): map version RPC + readyz DO ping — TOM-61 (half), TOM-32 (2.8)
`Room.getVersion(): Promise<number>` and `bumpVersion()` (storage counter; `broadcast` of `area:*` bumps it); `/readyz` adds `room: 'up'` by calling `getVersion()` with a `TIMEOUTS.DO_PING_MS` deadline (503 `{ db, room }` detail when either fails). Tests: version increments on broadcast; readyz reports both.

### H8 (web): projection + govmap CRS/tile layer — TOM-45 (5.4 spike closes), TOM-46 (5.5)
`src/lib/geo/projection.ts` (proj4 with the research string; `wgs84ToItm`, `itmToWgs84`; control-point tests ±0.01 m; `towgs84` guard test), `govmap-crs.ts` (`new L.Proj.CRS('EPSG:2039', <research proj4 string>, { origin: [-5403700, 7116700], resolutions: <12 levels>, bounds })` from proj4leaflet, D22; only `wrapLng: undefined` / `infinite: false` set on top if the plugin's defaults differ; no hand-written transformation or scale/zoom functions), `govmap-layer.ts` (`L.TileLayer` subclass overriding `getTileUrl` → `L{level 2-digit}/R{row hex8}/C{col hex8}.jpg`; fixtures L08/L10/L11 from the research as tests; `crossOrigin` off; `GOVMAP.CACHES` constant list). Deliverable also closes the spike: a `docs/adr/0005-govmap-crs-swap.md` recording the verified scheme, the Referer-locked 2025 endpoint, the retirement risk, and the terms note (facts only).

### H9 (api): cache layer — TOM-61 (3.6)
`src/cache/bounds.ts`: key `${ROUTES.AREAS}?tile=${tileKey}&z=${z}&v=${mapVersion}` via `caches.default`; `GET /api/areas` → `getVersion()` (DO RPC) → lookup → miss: query, store with `Cache-Control: s-maxage=${CACHE.BOUNDS_TTL_S}` + ETag; `If-None-Match` → 304; hit ratio logged. Tests (workerd `caches.default` is available in the vitest plugin): second identical read served from cache (spy on `withClient` not called); after `bumpVersion()` a read misses; ETag 304. README performance section: why Hyperdrive caching is off (ADR-0004).

### H10 (api): OpenAPI UI — TOM-62 (3.8)
`describeRoute` on every area route (already partly from T15), `/openapi.json` validated by an OpenAPI 3.1 validator in a test, `/docs` UI (Scalar via `@scalar/hono-api-reference` — verify package name/version; else Swagger UI from hono-openapi docs). `hono snapshot` run once to confirm every route is documented.

### H11 (realtime) + H14 (web): graceful degradation — TOM-39 (4.7)
Server: `error` events carry `resync: true` when the DO lost state; `join` after reconnect returns full `draft:state`. Client (`src/lib/ws.ts` from M1 T14 extended): state machine `connecting → open → degraded → offline`; backoff `WS.RECONNECT_BACKOFF_MS` with jitter; offline polling `WS.OFFLINE_POLL_MS` via `GET /api/areas`; local draft kept in memory and re-sent on reconnect; `ConnectionBanner` states. Chaos test (vitest with a fake socket; plus one Playwright scenario in M3): kill → banner → polls → reconnect → resync with no duplicate polygons.

### H12 (web): layer switch — TOM-47 (5.6)
`LayerSwitch` control (`MapControl` from the design system): on toggle, read centre/zoom, remove base layer, set `map.options.crs`, map zoom by nearest resolution, `setView(center, z, { reset: true })`, add the new base layer, re-add overlay panes' layers from WGS84 state (areas, drafts, ghosts), opacity crossfade over `MAP.CROSSFADE_MS` (respect reduced motion). Tests: jsdom unit for zoom mapping + overlay re-add; headless Chromium (Playwright, in M3's suite but written here as a script under `apps/web/e2e/`) for the pixel/centre check using the research fixture (Dizengoff fountain).

### H13 (web): area panel — TOM-52 (5.11)
`AreaPanel` (Panel + list of areas in view with name/km²; select → highlight; rename inline → PUT with version; history → `GET versions`; revert → POST revert → cache patch). Tests with mocked fetch.

### H16 (db): Drizzle builder system-wide — ticket 1.7 (D23), Wave 1 after H1 (same files)
`apps/api/src/db/spatial.ts`: `selectAreasInBounds` and the `current` read in `updateAreaIfVersion` become builder selects with `sql` fragments (`ST_AsGeoJSON(${areas.geom})::json`, `${areas.geom} && ST_MakeEnvelope(...)`), explicit column lists (never raw `geom`); the write CTEs stay and carry a comment naming the D23 exception. Any plain read in routes/services → builder. Lint guard (ESLint `no-restricted-syntax` on tagged template `sql` whose first quasi starts with `select`/`SELECT`, allow-list: spatial.ts write helpers, test files) proved with a probe. README "Database access rules" section. Tests: helper signatures unchanged, api suite green, probe fails lint.

### H15: integration + M2 epic review
Mount audit/rate-limit/timeout per H4/H5; cron trigger; constants doc tidy; README sections (performance, security, limitations updated with facts); process log; Linear M2 → Done; **M2 epic review (fable)** over the milestone range + one opus fix round + scoped re-review.

## Self-review
- Spec coverage for M2: §5 layer switch (H8, H12), viewport fetch cache (H7, H9), degradation (H11, H14), §6 errors (H5, H6), §10 D3 (H8), D5 (H5, H6), D6 (H7, H9), D8 (H2), D13 (H6). Brief items: rate limiting ✔, spatial index proof ✔ (H1), caching ✔, conflict resolution (M1 T15) ✔, validation (M1) ✔, audit ✔ (H4), degradation ✔, health ✔ (H7), schema/migrations (M1) ✔, 10k polygons ✔ (H1), soft delete + retention ✔ (H2), sanitization/CORS/logging/timeouts ✔ (M1 T3 + H5), WS auth (M1 T5) ✔, two base layers + smooth transition + overlays positioned ✔ (H8, H12), draw on both layers ✔ (H12 re-adds the draw handler), live area ✔ (M1), presence ✔ (M1), projections ✔ (H8), WS message optimisation ✔ (M1 T7 deltas + H6), Earth-curvature area ✔ (M1), connection pooling ✔ (Hyperdrive), horizontal scaling ✔ (ADR-0004), telemetry → E8, OpenAPI ✔ (H10), benchmarks (H1 first table; k6 in M3).
- Type consistency: `getVersion/bumpVersion` (H7) consumed by H9; `AreaVersion` (M0 follow-up) by H3/H13; `rateLimit` + `RateLimiter.take` (M1) by H5/H6; `PolygonDraw` events (M1 T11a) by H12; `ws.ts` state machine (M1 T14) by H14.
- Parallel safety: wave-1 tasks have disjoint files; H6/H7 are both realtime (same lane, sequential or one dispatch); shared-file edits are named exceptions.
