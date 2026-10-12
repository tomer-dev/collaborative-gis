# M1 Vertical Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan. Tasks are grouped in **lanes** and **waves**; tasks in the same wave but different lanes run **in parallel**, each implementer in its own harness-isolated git worktree (`Agent` tool `isolation: worktree`), each on its own branch + PR. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A signed-in user draws a polygon on an OSM map, saves it, sees its area in km², and a second browser sees the polygon appear live; presence and live draft ghosts work through a Durable Object.

**Architecture:** Hono Worker (`apps/api`) with Better Auth, Zod validation at the boundary, Drizzle over Hyperdrive→PostGIS (`areas`, `area_versions`, `audit_log`), one `Room` Durable Object (WebSocket Hibernation API) for presence/draft broadcast/fan-out; Vite+React SPA (`apps/web`) with TanStack Router/Query, Leaflet 1.9.4, a hand-rolled draw `Handler`, and a WS hook. Contracts in `packages/shared`.

**Tech Stack (verified 2026-10-12 with `npm view`):** drizzle-orm 0.45.4, drizzle-kit 0.31.11, better-auth 1.7.7, @better-auth/cli 1.4.21, hono-openapi 1.3.5, @tanstack/react-router 1.170.42, @tanstack/router-plugin 1.168.43, @tanstack/react-query 5.104.2, leaflet 1.9.4, @types/leaflet 1.9.22, hono ^4.13, zod ^4.6, vitest ^5, @cloudflare/vitest-plugin ^1.4, wrangler ^4.149, TypeScript 5.9.3 (user ruling), pnpm 12.5.1. Versions are floors: implementers use the latest release pnpm's minimum-release-age policy accepts and cite `npm view` in their report.

**Spec:** `docs/superpowers/specs/2026-10-12-collaborative-gis-design.md` (approved; §2–§8, §10). Roadmap + ticket IDs: `docs/roadmap.md` (Linear P-TOM-1, milestone "M1 Vertical slice": TOM-18..21, 25..28, 31, 33..37, 42..44, 48..51, 54..55, plus TOM-56 (3.3) pulled into M1 because 5.9 needs it). M0 ledger rulings: `.superpowers/sdd/2026-10-12-m0-foundation/progress.md`.

**Base:** `main` after PR #1 (M0) and the M0 follow-up PR are merged. Every lane branches from that commit.

## Global Constraints

- Workers run on workerd; `apps/api` must never import Node-only modules outside `nodejs_compat`. `compatibility_flags: ["nodejs_compat"]` stays.
- Database access from the Worker only via `env.HYPERDRIVE.connectionString`; one `pg` Client per request (transaction pooling: no session state, no prepared statements kept); migrations run against the Neon **direct** URL (CI secret `DATABASE_URL`), never through Hyperdrive.
- Polygon rules (spec §5): ≥3 unique vertices, closed ring, lng ∈ [-180,180], lat ∈ [-90,90], ≤1,000 vertices; server adds `ST_IsValid` with `ST_IsValidReason` in the 422 body.
- All API errors use `ApiError = { code, message, details? }` via `apps/api/src/errors.ts` (`apiError`, `codeFor`); 4xx deliberate, 5xx sanitised; `HTTPException` passes through with its status. Validation → 422, auth → 401, conflict → 409 with the server copy in `details`, timeout → 504.
- WS envelope `{ type, seq, ts, payload }` from `@cgis/shared` (`WsEnvelopeSchema`, `parseWsMessage`); malformed → `error` event, socket kept.
- Single map, room id `default` (D11). Any signed-in user edits any area (D12). Defaults: drafts ≤10 msg/s per user, presence dropped after 60 s, names ≤120 chars (D13).
- Secrets never enter the repo: `.dev.vars` (git-ignored) for `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `CLIENT_ORIGIN`; `.dev.vars.example` documents them.
- Every commit message ends with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Git is invoked as `/usr/bin/git -C "<worktree>" <one subcommand>` per command.
- Root checks must stay green in every lane: `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test`, `pnpm --filter @cgis/web build`, wrangler dry-run. CI runs them on every PR.
- Append one numbered line per task to `docs/process-log.md` **only in the integration task (T16)**; lanes do not touch it (merge conflicts).
- **No hardcoded values (user ruling 2026-10-12):** limits, rates, timeouts, route paths, error codes/messages, default map view and pane names come from `packages/shared/src/constants.ts` (`LIMITS`, `WS`, `TIMEOUTS`, `ROUTES`, `ROOM`, `MAP`, `ERROR_CODES`, created in T0) and are mirrored in `docs/constants.md`. Lanes import them and extend both files for new values; a literal in app code is a review finding (test expectations exempt).

## Parallel execution rules

- **File ownership is exclusive per lane** (table below). A lane that needs a change in another lane's file reports NEEDS_CONTEXT; the controller rules.
- **No lane edits `package.json`, `pnpm-lock.yaml`, `wrangler.jsonc`, `app.ts`, `index.ts`, or `packages/shared`** after Wave 0. Wave 0 installs every M1 dependency and wires every composition point.
- Each lane = one implementer, one isolated worktree, one branch `m1/<lane>`, one PR into `main` per wave. The controller merges lanes in the order db → auth → api → realtime → web (or as they finish, rebasing on `main`).
- Test isolation: api tests use the shared compose PostGIS on `127.0.0.1:5433`. Each lane uses its **own database name** to avoid cross-lane interference: `cgis_<lane>` created by the lane's test setup (`CREATE DATABASE` through the `cgis` superuser) and migrated with drizzle before tests. Wave 0 provides `scripts/db-lane.sh <name>`.

## Lanes, waves, ownership

| Wave | db lane | auth lane | api lane | realtime lane | web lane |
|---|---|---|---|---|---|
| 0 | **T0 scaffold** (single task, alone) | | | | |
| 1 | T1 schema+migrations | T3 cors/headers/log/timeout | — | T6 Room DO skeleton (stub auth header) | T9 shell (router/query/auth ctx, mocked session) |
| 2 | T2 spatial helpers (bbox, area, isvalid) | T4 Better Auth · T5 requireUser + WS gate | T15 validation + routes (needs T2, T5) | T7 protocol/presence/drafts | T10 OSM map · T11 draw tool + live area |
| 3 | — | — | — | T8 fan-out RPC (needs T15) | T12 auth pages · T13 data layer · T14 WS hook |
| 4 | **T16 integration + process log** (single task) | | | | |

Ownership (create/modify only these):
- **db:** `apps/api/src/db/**` (except `auth-schema.ts`), `apps/api/drizzle.config.ts`, `apps/api/drizzle/**`, `scripts/db-lane.sh`, `apps/api/test/db/**`.
- **auth:** `apps/api/src/auth.ts`, `apps/api/src/db/auth-schema.ts`, `apps/api/drizzle/0002_auth.sql` (generated), `apps/api/src/middleware/**`, `apps/api/test/auth/**`, `apps/api/.dev.vars.example`.
- **api:** `apps/api/src/routes/areas.ts`, `apps/api/src/routes/areas.test.ts` → `apps/api/test/areas/**`, `apps/api/src/services/areas.ts`.
- **realtime:** `apps/api/src/do/**`, `apps/api/src/ws.ts`, `apps/api/test/room/**`.
- **web:** `apps/web/**` except `package.json`.
- **Wave 0 / integration only:** `packages/shared/**`, `apps/api/src/app.ts`, `apps/api/src/index.ts`, `apps/api/wrangler.jsonc`, `apps/api/package.json`, `apps/web/package.json`, `apps/web/vite.config.ts`, `pnpm-lock.yaml`, `.github/workflows/ci.yml`, `docs/process-log.md`, `README.md`.

## Review Focus

1. A polygon with a self-intersection passes Zod but must fail on the server with 422 and `ST_IsValidReason` text (T2/T15 test).
2. Two concurrent `PUT /api/areas/:id` with the same `version`: exactly one 200, one 409 whose `details.current` is the winner's row (T15 test).
3. A WS frame that is valid JSON but fails the envelope schema gets an `error` event and the socket stays open; a non-JSON frame likewise (T7 test).
4. After the Room DO hibernates (simulated by a fresh stub instance), the presence list is rebuilt from socket attachments, not memory (T7 test).
5. A signed-out browser hitting `/map` is redirected to `/login`, and a `/ws` upgrade without a session cookie gets 401 (T9/T5 tests).

---

## Wave 0

### T0: Scaffold for parallel lanes (db-shared lane, runs alone) — tickets: none (enables TOM-18..56)

**Files:**
- Modify: `packages/shared/src/ws.ts`, `packages/shared/src/ws.test.ts`, `packages/shared/src/api.ts`
- Modify: `apps/api/package.json`, `apps/web/package.json`, `pnpm-lock.yaml`
- Modify: `apps/api/wrangler.jsonc`, `apps/api/src/app.ts`, `apps/api/src/index.ts`, `apps/web/vite.config.ts`
- Create (stubs): `apps/api/src/routes/areas.ts`, `apps/api/src/ws.ts`, `apps/api/src/do/room.ts`, `apps/api/src/middleware/index.ts`, `apps/api/src/auth.ts`, `apps/api/src/db/index.ts`, `scripts/db-lane.sh`
- Test: `apps/api/test/scaffold.test.ts`

**Interfaces (Produces, consumed by every lane):**
- Shared: `WsEnvelopeSchema` gains `{ type: 'draft:state', payload: { drafts: Array<{ userId: string; vertices: [number, number][] }> } }` (server→client on join) and `{ type: 'presence:set', payload: { state: 'viewing' | 'drawing' } }` (client→server). `WsClientEventSchema = WsEnvelopeSchema` narrowed to `join | leave | draft:update | presence:set`. `ApiErrorCode` string-literal union: `BAD_REQUEST | UNAUTHORIZED | FORBIDDEN | NOT_FOUND | CONFLICT | UNPROCESSABLE | PAYLOAD_TOO_LARGE | RATE_LIMITED | TIMEOUT | NOT_READY | INTERNAL`.
- `apps/api/src/app.ts`:
  ```ts
  export type Env = CloudflareBindings; // generated by `pnpm types`
  export type AppEnv = { Bindings: Env; Variables: { user?: { id: string; name: string }; requestId: string } };
  export function createApp(): Hono<AppEnv>  // mounts, in this order:
  //   app.use('*', middleware())          // from ./middleware (T3 fills: requestId, cors, secureHeaders, timeout)
  //   app.route('/', health)
  //   app.all('/api/auth/*', authHandler) // from ./auth (T4 fills)
  //   app.route('/api/areas', areas)      // from ./routes/areas (T15 fills)
  //   app.get('/ws', wsUpgrade)           // from ./ws (T6 fills)
  //   app.notFound / app.onError (M0 follow-up versions)
  ```
  Stubs: `middleware()` = `(c, next) => next()`; `authHandler` = `apiError(c, 501, 'INTERNAL', 'not implemented')`; `areas` = `new Hono<AppEnv>()` with no routes; `wsUpgrade` = 501.
- `apps/api/src/index.ts`: `export { Room } from './do/room'; export default { fetch: app.fetch } satisfies ExportedHandler<Env>`.
- `apps/api/src/do/room.ts` stub: `export class Room extends DurableObject<Env> { async fetch() { return new Response('not implemented', { status: 501 }); } }`.
- `apps/api/src/db/index.ts`: `export async function withClient<T>(env: Env, fn: (client: pg.Client) => Promise<T>): Promise<T>` — one Client per call, `connectionTimeoutMillis: 3000`, `end()` in `finally` (moved from `health.ts`; `checkDatabase` now uses it). `export function db(client: pg.Client)` returns `drizzle(client, { schema })` where `schema` is `import * as schema from './schema'` (T1 fills `schema.ts`; T0 creates it empty: `export {}`).
- `wrangler.jsonc`: `"durable_objects": { "bindings": [{ "name": "ROOM", "class_name": "Room" }] }`, `"migrations": [{ "tag": "v1", "new_sqlite_classes": ["Room"] }]`, `"vars": { "CLIENT_ORIGIN": "http://localhost:5173" }`. Secrets `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` documented in `.dev.vars.example` (auth lane finalises).
- `apps/web/vite.config.ts`: `tanstackRouter({ target: 'react', autoCodeSplitting: true })`, `react()`, `tailwindcss()`; `server.proxy = { '/api': 'http://localhost:8787', '/ws': { target: 'ws://localhost:8787', ws: true } }`.
- Dependencies installed (api): `drizzle-orm`, `better-auth`, `hono-openapi`; dev: `drizzle-kit`, `@better-auth/cli`. (web): `@tanstack/react-router`, `@tanstack/react-query`, `leaflet`; dev: `@tanstack/router-plugin`, `@types/leaflet`. All at latest accepted release.
- `scripts/db-lane.sh <name>`: `psql postgresql://cgis:cgis@127.0.0.1:5433/cgis -c "create database <name>"` (idempotent via `select 1 from pg_database`), then `create extension if not exists postgis` in it. Prints the URL. Used by lane test setups via `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` (verified by the Task 3 implementer: wrangler and the vitest plugin honour it).

- [ ] **Step 1: Failing contract tests** — `packages/shared/src/ws.test.ts`: `draft:state` with two drafts parses; `presence:set` with `state: 'sleeping'` fails; `WsClientEventSchema` rejects `area:created`. Run `pnpm --filter @cgis/shared test` → FAIL.
- [ ] **Step 2: Implement the schema additions**; GREEN.
- [ ] **Step 3: Install dependencies** with the `pnpm --filter … add` commands; commit lockfile.
- [ ] **Step 4: Stubs + wiring** per Interfaces; `apps/api/test/scaffold.test.ts` (workerd via `SELF`): `GET /api/areas` → 404 ApiError (no routes yet), `GET /api/auth/ok` → 501, `GET /ws` → 501, `GET /healthz` → 200, `GET /readyz` → 200 (now through `withClient`). RED → GREEN.
- [ ] **Step 5: `pnpm types` regenerates `worker-configuration.d.ts` with `ROOM`**; `Env = CloudflareBindings` compiles; `wrangler deploy --dry-run` passes with the DO migration.
- [ ] **Step 6: web**: router plugin + Tailwind in `vite.config.ts`; `src/routes/__root.tsx` + `src/routes/index.tsx` minimal so the plugin generates `routeTree.gen.ts` (git-ignored? **No**: commit it; TanStack recommends committing). `pnpm --filter @cgis/web build` passes; App test still green.
- [ ] **Step 7: Root checks, commit `feat: M1 scaffold — deps, DO binding, composition stubs, contracts`, PR `m1/scaffold`.**

---

## Wave 1

### T1 (db): Drizzle schema + migrations — TOM-18, TOM-19

**Files:** `apps/api/src/db/schema.ts`, `apps/api/drizzle.config.ts`, `apps/api/drizzle/0000_postgis.sql` (hand-written: `create extension if not exists postgis`), `apps/api/drizzle/0001_*.sql` (generated), `apps/api/src/db/migrate.ts`, `apps/api/test/db/schema.test.ts`, `.github/workflows/ci.yml` (**exception granted**: add the migrate step), `README.md` section "Migrations" (**exception**).

**Interfaces — Produces:**
```ts
// schema.ts (drizzle-orm/pg-core)
export const areas = pgTable('areas', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  geom: geometry('geom', { type: 'Polygon', srid: 4326 }).notNull(),
  areaKm2: numeric('area_km2', { precision: 14, scale: 6 }).notNull(),
  version: integer('version').notNull().default(1),
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (t) => [index('areas_geom_gist').using('gist', t.geom).where(sql`${t.deletedAt} is null`)]);
export const areaVersions = pgTable('area_versions', { areaId: uuid().notNull().references(() => areas.id), version: integer().notNull(), name: text().notNull(), geom: geometry({ type: 'Polygon', srid: 4326 }).notNull(), areaKm2: numeric({ precision: 14, scale: 6 }).notNull(), changedBy: text().notNull(), changedAt: timestamp({ withTimezone: true }).notNull().defaultNow() }, (t) => [primaryKey({ columns: [t.areaId, t.version] })]);
export const auditLog = pgTable('audit_log', { id: bigserial({ mode: 'number' }).primaryKey(), userId: text(), action: text().notNull(), entity: text().notNull(), entityId: text(), ip: text(), userAgent: text(), payloadHash: text(), at: timestamp({ withTimezone: true }).notNull().defaultNow() });
```
`migrate.ts`: `export async function migrate(url: string)` using `drizzle-orm/node-postgres/migrator` with `migrationsFolder: 'drizzle'`; CLI entry `pnpm --filter @cgis/api db:migrate` reads `DATABASE_URL`. `drizzle.config.ts`: `dialect: 'postgresql'`, `schema: ['./src/db/schema.ts', './src/db/auth-schema.ts']` (auth lane adds the file; T1 creates it as `export {}` — **shared-file exception, T1 owns the placeholder**), `out: './drizzle'`.

- [ ] Steps: failing test (`test/db/schema.test.ts` runs `migrate()` against `cgis_db` from `db-lane.sh`, then `select postgis_version()`, `\d areas` columns, GiST index present via `pg_indexes`) → implement → `drizzle-kit generate` → GREEN → CI: add `pnpm --filter @cgis/api db:migrate` with `DATABASE_URL=postgresql://cgis:cgis@localhost:5433/cgis` before tests → README "Migrations: direct URL only; Hyperdrive at runtime" → commit → PR `m1/db`.

### T3 (auth): Cross-cutting middleware — TOM-27, TOM-31 (+ timeout from 2.6, minimal)

**Files:** `apps/api/src/middleware/index.ts`, `apps/api/src/middleware/request-id.ts`, `apps/api/src/middleware/logger.ts`, `apps/api/test/auth/middleware.test.ts`.

**Produces:** `middleware()` = `every([requestId(), cors({ origin: env.CLIENT_ORIGIN, credentials: true }), secureHeaders(), timeout(10_000, () => new HTTPException(504, { message: 'timeout' }))])` with `c.set('requestId', crypto.randomUUID())` and `c.header('x-request-id')`; `log(c, level, msg, extra)` helper emitting one JSON line `{ level, msg, requestId, userId?, path, ...extra }` with keys `password|secret|cookie|authorization` redacted. `onError` in `app.ts` is **not** edited; it already logs; T16 switches it to `log()`.

- [ ] Tests: preflight from `CLIENT_ORIGIN` → 204 with `access-control-allow-credentials: true`; from another origin → no allow-origin header; `x-request-id` present and uuid; `x-content-type-options: nosniff` present; a test route that awaits 11 s → 504 `{ code: 'TIMEOUT' }` (use fake timers or a 50 ms timeout in the test app). RED → GREEN → PR `m1/auth-w1`.

### T6 (realtime): Room DO skeleton with stub auth — TOM-33

**Files:** `apps/api/src/do/room.ts`, `apps/api/src/ws.ts`, `apps/api/test/room/upgrade.test.ts`.

**Produces:**
```ts
// ws.ts — Worker side
export const wsUpgrade: Handler<AppEnv> = async (c) => {
  if (c.req.header('upgrade') !== 'websocket') return apiError(c, 426, 'BAD_REQUEST', 'websocket upgrade required');
  const user = c.get('user') ?? stubUserFromHeader(c); // T5 replaces stub: without session → 401
  if (!user) return apiError(c, 401, 'UNAUTHORIZED', 'sign in');
  const id = c.env.ROOM.idFromName('default');
  const headers = new Headers(c.req.raw.headers);
  headers.set('x-user-id', user.id); headers.set('x-user-name', user.name);
  return c.env.ROOM.get(id).fetch(new Request(c.req.url, { headers }));
};
// room.ts
export class Room extends DurableObject<Env> {
  async fetch(req: Request): Promise<Response> // accepts WS: ctx.acceptWebSocket(server); serializeAttachment({ userId, name, color, state:'viewing', lastSeen }); setWebSocketAutoResponse(ping→pong)
  async webSocketMessage(ws, msg) {}   // T7
  async webSocketClose(ws, code, reason, wasClean) {}  // T7
  async broadcast(event: WsEvent, exceptUserId?: string): Promise<void> // RPC, T8 uses
}
```
`stubUserFromHeader`: reads `x-debug-user` header (`id:name`) **only when `env.DEBUG_STUB_AUTH === '1'`** (wrangler `vars` in T0: not set in prod). Colour = deterministic from userId hash.

- [ ] Tests (workerd, `SELF.fetch` with `Upgrade: websocket` + `x-debug-user`, env var set in `vitest.config.ts` `miniflare.bindings`): 101 and `ws.accept()` works; without the header → 401; wrong path → 404; the DO reports `ctx.getWebSockets().length === 1` via a debug `GET /ws/_count` on the DO fetch (test-only route guarded by the same flag). RED → GREEN → PR `m1/realtime-w1`.

### T9 (web): SPA shell — TOM-42

**Files:** `apps/web/src/routes/__root.tsx`, `src/routes/index.tsx`, `src/routes/login.tsx`, `src/routes/map.tsx`, `src/router.tsx`, `src/main.tsx`, `src/lib/session.ts`, `src/lib/query.ts`, `src/App.tsx` (remove), `src/routes/map.test.tsx`.

**Produces:** `useSession(): { data: { id: string; name: string } | null; isPending: boolean }` from `lib/session.ts` — in Wave 1 a `fetch('/api/auth/get-session')` wrapper whose shape matches Better Auth's client (`{ user: { id, name } } | null`), tested with a mocked fetch; T12 swaps the body for `createAuthClient().useSession`. Router context `{ queryClient, session }`; `/map` has `beforeLoad` → `redirect({ to: '/login' })` when `session === null`. Layout: full-viewport, Tailwind, a top bar with app name + user name + sign-out button (no-op until T12).

- [ ] Tests (jsdom): rendering the router at `/map` with `session: null` ends at `/login`; with a session renders the map route's placeholder `<div data-testid="map-root">`. RED → GREEN → `pnpm --filter @cgis/web build` → PR `m1/web-w1`.

---

## Wave 2

### T2 (db): Spatial helpers — TOM-20, TOM-21

**Files:** `apps/api/src/db/spatial.ts`, `apps/api/test/db/spatial.test.ts`, `apps/api/src/db/seed.ts` (small: 50 random polygons in Israel bounds for tests; the 10k seed is M2).

**Produces (all take a `pg.Client`, return typed rows):**
```ts
export type AreaRow = Area; // @cgis/shared, geometry as GeoJSON
export async function insertArea(c, input: { name: string; geometry: Polygon; userId: string }): Promise<AreaRow>  // single statement with CTE: validate ST_IsValid → raise; insert with area_km2 = ST_Area(geom::geography)/1e6; insert version 1; returns row with ST_AsGeoJSON(geom)::json as geometry
export async function updateAreaIfVersion(c, id: string, input: { name; geometry; userId; version: number }): Promise<{ ok: true; area: AreaRow } | { ok: false; current: AreaRow | null }>  // UPDATE … WHERE id=$1 AND version=$2 AND deleted_at IS NULL; 0 rows → select current
export async function selectAreasInBounds(c, bbox: [w,s,e,n], opts: { limit: number; simplifyTolerance?: number }): Promise<AreaRow[]>  // geom && ST_MakeEnvelope($1,$2,$3,$4,4326) AND deleted_at IS NULL; ST_SimplifyPreserveTopology when tolerance given
export async function softDeleteArea(c, id, userId): Promise<boolean>
export async function writeAudit(c, row: { userId; action; entity; entityId?; ip?; userAgent?; payloadHash? }): Promise<void>
export class InvalidGeometryError extends Error { reason: string }  // from ST_IsValidReason
```
- [ ] Tests against `cgis_db`: bowtie polygon → `InvalidGeometryError` with reason containing "Self-intersection"; a 0.1°×0.1° square at lat 32 → `areaKm2` within 0.1% of 102.9 km² (reference: 0.1° lat ≈ 11.09 km, 0.1° lon at 32° ≈ 9.40 km → 104.3 km²; compute the reference with a geodesic formula in the test, not a magic number); bounds query returns only intersecting, non-deleted rows; `EXPLAIN` of the bounds query contains `Index Scan` or `Bitmap Index Scan` on `areas_geom_gist` after seeding 50 rows + `ANALYZE`; `updateAreaIfVersion` with a stale version returns `{ ok: false, current }`. RED → GREEN → PR `m1/db-w2`.

### T4 (auth): Better Auth on Workers — TOM-25

**Files:** `apps/api/src/auth.ts`, `apps/api/src/db/auth-schema.ts` (generated by `npx @better-auth/cli generate` then committed), `apps/api/drizzle/0002_auth.sql` (`drizzle-kit generate`), `apps/api/.dev.vars.example`, `apps/api/test/auth/auth.test.ts`.

**Produces:** `createAuth(env: Env, client: pg.Client)` → `betterAuth({ database: drizzleAdapter(db(client), { provider: 'pg', schema }), emailAndPassword: { enabled: true }, trustedOrigins: [env.CLIENT_ORIGIN], baseURL: env.BETTER_AUTH_URL, secret: env.BETTER_AUTH_SECRET, advanced: { useSecureCookies: env.BETTER_AUTH_URL.startsWith('https') } })`; `authHandler: Handler<AppEnv>` = `withClient(c.env, (client) => createAuth(c.env, client).handler(c.req.raw))`; `getSessionUser(env, headers): Promise<{ id; name } | null>` via `auth.api.getSession({ headers })`. Risk register item 2 (per-request client with the Drizzle adapter over Hyperdrive) is validated here: the test signs up, signs in, and calls `get-session` across three separate requests.

- [ ] Tests (workerd, `cgis_auth` db migrated with 0000–0002): `POST /api/auth/sign-up/email` → 200 + `set-cookie`; `POST /api/auth/sign-in/email` → 200; `GET /api/auth/get-session` with the cookie → user; without → null. RED → GREEN → PR `m1/auth-w2a`.

### T5 (auth): Session guard + WS gate — TOM-26 (after T4, same lane)

**Files:** `apps/api/src/middleware/require-user.ts`, `apps/api/src/middleware/index.ts` (add `attachUser()` to the chain: sets `c.set('user', …)` when a session exists, never rejects), `apps/api/test/auth/require-user.test.ts`.

**Produces:** `requireUser(): MiddlewareHandler<AppEnv>` → 401 `UNAUTHORIZED` when `c.get('user')` is undefined. The `/ws` route gets `requireUser()` in `app.ts` **via T16** (integration) — T5 only ships the middleware and a test proving `wsUpgrade` with no session → 401 when composed `requireUser()` → `wsUpgrade`. `stubUserFromHeader` stays behind the `DEBUG_STUB_AUTH` flag for the realtime lane's tests.

- [ ] Tests: protected test route with cookie → 200 with `user.id`; without → 401 body `{ code: 'UNAUTHORIZED', message: 'sign in' }`. PR `m1/auth-w2b`.

### T15 (api): Validation + area routes — TOM-28, TOM-54, TOM-55, TOM-56

**Files:** `apps/api/src/routes/areas.ts`, `apps/api/src/services/areas.ts`, `apps/api/test/areas/*.test.ts`, `apps/api/batch/areas.jsonl` (Hono CLI contract file, run with `hono batch batch/areas.jsonl --runtime workerd` in CI via T16).

**Consumes:** T2 helpers, T5 `requireUser`, `hono-openapi` `validator` + `describeRoute`, `apiError`.
**Produces:**
- `POST /api/areas` body `AreaCreateSchema` → 201 `Area`; `InvalidGeometryError` → 422 `{ code: 'UNPROCESSABLE', message, details: { reason } }`; writes audit `area.create`; calls `c.executionCtx.waitUntil(fanout(c.env, { type: 'area:created', … }))` where `fanout` is a **no-op stub exported from `services/areas.ts`** that T8 replaces.
- `GET /api/areas?bbox=w,s,e,n&zoom=z` query `BoundsQuerySchema` → 200 `{ areas: Area[] }`, limit 500, `simplifyTolerance = zoom < 12 ? 0.0005 : undefined`.
- `PUT /api/areas/:id` body `AreaUpdateSchema` → 200 `Area` or 409 `{ code: 'CONFLICT', message, details: { current: Area } }` or 404.
- `DELETE /api/areas/:id` → 204 (soft) — small, included because 5.9 needs delete to round-trip.
- Zod failures → 422 `{ code: 'UNPROCESSABLE', details: issues }` via a `validator` hook.
- `GET /openapi.json` via `openAPIRouteHandler` (documentation only; the `/docs` UI is M2).

- [ ] Tests (workerd, `cgis_api` db, `DEBUG_STUB_AUTH=1` header for auth until T16 flips to cookies): create → 201 with `areaKm2 > 0`; open ring → 422 from Zod; bowtie → 422 with reason; bbox returns the created area and excludes a far one; two parallel PUTs with version 1 → one 200 + one 409 with `details.current.version === 2`; delete → bbox no longer returns it; `hono batch` file covers create→bbox→conflict→delete with `expect.status`. PR `m1/api`.

### T7 (realtime): Protocol, presence, drafts — TOM-34, TOM-35, TOM-36

**Files:** `apps/api/src/do/room.ts`, `apps/api/src/do/presence.ts`, `apps/api/src/do/drafts.ts`, `apps/api/test/room/protocol.test.ts`.

**Produces:** `webSocketMessage`: parse with `parseWsMessage` → on throw send `error { code: 'BAD_REQUEST' }` (socket kept, count strikes in attachment; 10 strikes → close 1008); `join` → reply `presence { users }` + `draft:state { drafts }`; `presence:set` → update attachment, broadcast `presence`; `draft:update` → per-sender token bucket 10/s (in attachment: `{ tokens, refilledAt }`), drop frames with `seq <= lastSeq`, apply to the sender's draft (stored in DO SQLite `drafts(user_id, vertices json, updated_at)`), rebroadcast to others; `leave`/`webSocketClose`/`webSocketError` → delete draft, broadcast `presence`. `alarm()` every 30 s: drop drafts idle > 60 s and broadcast. Presence is always derived from `ctx.getWebSockets().map(ws => ws.deserializeAttachment())`.

- [ ] Tests: two sockets join → both get `presence` with 2 users; A sends 3 `draft:update` → B receives 3, A receives 0; 11 updates in 100 ms → the 11th is answered with `error { code: 'RATE_LIMITED' }` to A only; garbage frame → `error` and socket still open; a new `Room` instance (fresh `DurableObjectState` from `cloudflare:test` `runInDurableObject`) with existing accepted sockets reconstructs presence from attachments. PR `m1/realtime-w2`.

### T10 (web): Leaflet OSM map — TOM-44

**Files:** `apps/web/src/components/Map.tsx`, `src/lib/map.ts`, `src/routes/map.tsx` (fill), `src/components/Map.test.tsx`.

**Produces:** `<MapView onReady={(map: L.Map) => void}>` creating `L.map(el, { center: [31.5, 34.9], zoom: 8, zoomControl: true })` + `L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap contributors', maxZoom: 19 })`; panes `areas` (z 450) and `drafts` (z 460) created up front (layer switch in M2 re-adds overlays by pane). CSS import `leaflet/dist/leaflet.css`. `lib/map.ts`: `boundsToBbox(map): [w,s,e,n]`.

- [ ] Tests (jsdom): component mounts and calls `onReady` with a map whose `getCenter()` ≈ Israel; `boundsToBbox` on a known bounds object. PR `m1/web-w2a`.

### T11 (web): Draw tool + live area — TOM-48, TOM-49 (after T10)

**Files:** `apps/web/src/lib/draw-handler.ts`, `src/lib/geodesic.ts`, `src/components/DrawControl.tsx`, `src/lib/draw-handler.test.ts`, `src/lib/geodesic.test.ts`.

**Produces:** `class PolygonDraw extends L.Handler` with events `draw:vertex`, `draw:change` (`{ vertices: [number, number][] }` as `[lng, lat]`), `draw:done` (closed ring), `draw:cancel`; click adds a vertex, drag a handle moves it, double-click or Enter closes (needs ≥3 unique), Esc cancels, Backspace undoes; keyboard focusable container with `role="application"` and `aria-label`. `geodesic.ts`: `ringAreaKm2(ring: [number,number][]): number` using the spherical excess (Chamberlain–Duquette) on the WGS84 sphere (R = 6371008.8 m) — the server's `ST_Area(geography)` is spheroidal; the acceptance is < 0.5% difference, tested with a 0.1° square at lat 32 (client vs the reference value computed from the geodesic formula in the test). `DrawControl` shows the live area readout from `ringAreaKm2`.

- [ ] Tests: handler state machine (add 3, close → `draw:done` ring closed and first == last; Esc → cancel; Backspace removes last); `ringAreaKm2` of the test square within 0.5% of the geodesic reference; readout text updates on `draw:change`. PR `m1/web-w2b`.

---

## Wave 3

### T8 (realtime): Persistence fan-out — TOM-37 (after T15 merged)

**Files:** `apps/api/src/services/fanout.ts` (**ownership transferred to realtime for this task**), `apps/api/src/services/areas.ts` (replace the stub import only), `apps/api/test/room/fanout.test.ts`.

**Produces:** `fanout(env, event: WsEvent)` → `env.ROOM.get(env.ROOM.idFromName('default')).broadcast(event)` (DO RPC). `Room.broadcast` assigns `seq` from a DO-storage counter and `ts = Date.now()`, sends to all sockets, and bumps `mapVersion` in storage (the D6 cache key counter; the cache layer itself is M2).

- [ ] Test: open a socket, `POST /api/areas` → the socket receives `area:created` whose `payload.area.id` matches the 201 body. PR `m1/realtime-w3`.

### T12 (web): Auth pages — TOM-43 (after T4 merged)

**Files:** `apps/web/src/lib/auth-client.ts` (`createAuthClient({ baseURL: '/api/auth' })` from `better-auth/react`), `src/lib/session.ts` (swap to `authClient.useSession`), `src/routes/login.tsx`, `src/routes/register.tsx`, top-bar sign-out, tests with `msw` or mocked fetch (`msw` added as a web devDependency here — **exception**).

- [ ] Tests: login form submits `signIn.email`, on success navigates to `/map`; error shows the message; sign-out returns to `/login`. PR `m1/web-w3a`.

### T13 (web): Areas data layer — TOM-50 (after T15 merged)

**Files:** `apps/web/src/lib/api.ts` (fetch wrappers typed from `@cgis/shared`), `src/lib/areas-query.ts` (`useAreasInBounds(bbox)` key `['areas', bboxKey]`, `moveend` debounced 250 ms), `src/components/AreasLayer.tsx` (renders `L.polygon` in pane `areas`, click selects), `src/components/SaveDialog.tsx`, `src/components/ConflictDialog.tsx` (two buttons: "Overwrite with mine" resends with server version; "Load theirs" replaces local), mutations with `onMutate` snapshot + `onError` rollback on 409.

- [ ] Tests: query key changes on bbox change; optimistic create appears immediately and rolls back on a mocked 422; a mocked 409 opens the conflict dialog with the server copy; "Load theirs" sets the cache to `details.current`. PR `m1/web-w3b`.

### T14 (web): WS client hook — TOM-51 (after T7/T8 merged)

**Files:** `apps/web/src/lib/ws.ts` (connection state machine `connecting → open → degraded → offline` with backoff 1 s→30 s + jitter; `send(event)`; typed `on(type, handler)`), `src/lib/use-room.ts` (presence list, remote drafts, `area:*` → `queryClient.setQueryData` patches, resync via `invalidateQueries(['areas'])` on reopen), `src/components/PresenceList.tsx`, `src/components/GhostPolygons.tsx` (pane `drafts`, user colour), `src/components/ConnectionBanner.tsx`, tests with a fake `WebSocket`.

- [ ] Tests: state transitions on open/close/error; incoming `area:created` patches the `['areas', …]` cache; `draft:update` from another user renders a ghost; the draw handler's `draw:change` emits throttled `draft:update` (≤10/s); reconnect invalidates the areas query. PR `m1/web-w3c`.

---

## Wave 4

### T16: Integration + process log (single task, main checkout after all lanes merged)

**Files:** `apps/api/src/app.ts` (flip `/ws` to `requireUser()`, `onError` uses `log()`), `apps/api/src/ws.ts` (remove the stub user path except behind the flag), `.github/workflows/ci.yml` (`hono batch batch/areas.jsonl --runtime workerd` step; set `BETTER_AUTH_SECRET` test value and `DATABASE_URL` for migrate), `apps/api/batch/areas.jsonl` (switch from stub header to real sign-up/sign-in with cookie persistence), `docs/process-log.md` (one line per T0–T16), `README.md` (setup now includes `.dev.vars` and `pnpm --filter @cgis/api db:migrate`), Linear: M1 tickets → Done.

- [ ] Manual two-browser check on `wrangler dev` + `vite`: sign up A and B, A draws → B sees the ghost; A saves → B sees the polygon; both see each other in presence. Record the result (facts) in the process log. Root checks + CI green. PR `m1/integration`.

---

## Self-review (done at plan time)

1. **Spec coverage (M1 subset):** §2 single Worker + DO ✔ (T0, T6–T8); §3 components ✔ (shared T0, api T15, db T1/T2, auth T4/T5, Room T6/T7, web T9–T14; RateLimiter DO + scheduled purge are M2); §4 data model ✔ (T1); §5 save/concurrent-edit/live-drawing/viewport-fetch ✔ (T15, T7, T13; cache layer and layer switch M2; degradation T14 basic, chaos test M2); §6 ✔ (T3, T15, T7); §7 ✔ partial (rate limiter M2, WAF M4); §8 unit + integration ✔ (E2E M3).
2. **Placeholders:** none of "TBD/TODO"; every task names its tests and expected results.
3. **Type consistency:** `AppEnv` (T0) used by T3/T5/T6/T15; `withClient`/`db` (T0) used by T1/T2/T4; `AreaRow = Area` (T2) used by T15; `WsEvent` incl. `draft:state`/`presence:set` (T0) used by T7/T8/T14; `fanout` stub (T15) replaced by T8 with the same signature; `useSession` shape (T9) preserved by T12.
4. **Review Focus:** each of the five items is pinned to a task's test list above.
5. **Parallel safety:** ownership table has no overlaps except the three explicitly granted exceptions (T1 ci.yml/README migrate step, T1 `auth-schema.ts` placeholder, T12 `msw` devDependency, T8 `services/fanout.ts`); the controller merges those lanes first or rebases.
