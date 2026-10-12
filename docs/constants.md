# Constants

Single source of truth is `packages/shared/src/constants.ts`; this doc mirrors it. Add new values to both.

Import from `@cgis/shared` in app code (`@cgis/shared/constants` in Node-side config files such as `vite.config.ts` and `vitest.config.ts`). Lanes extend both files rather than writing literals. "Planned" names the M1 task that consumes a value.

## LIMITS

| Name | Value | Where used | Why |
|---|---|---|---|
| `POLYGON_MAX_VERTICES` | `1000` | `packages/shared/src/geo.ts` (ring max; re-exported under the old name), `apps/web/src/App.tsx` | Spec §5 polygon rule; bounds payload and `ST_IsValid` cost |
| `AREA_NAME_MAX` | `120` | `packages/shared/src/area.ts` (`AreaSchema.name`) | D13 name length cap |
| `BOUNDS_LIMIT` | `500` | Planned: T15 `GET /api/areas` row limit | Caps one viewport response |
| `SIMPLIFY_ZOOM_BELOW` | `12` | Planned: T15 (zoom below this gets simplified geometry) | Fewer vertices when zoomed out |
| `SIMPLIFY_TOLERANCE` | `0.0005` | Planned: T15 / T2 `ST_SimplifyPreserveTopology` tolerance (degrees) | ~50 m at the equator: invisible at zoom < 12 |

## WS

| Name | Value | Where used | Why |
|---|---|---|---|
| `DRAFT_RATE_PER_SEC` | `10` | Planned: T7 token bucket, T14 client throttle | D13: drafts ≤ 10 msg/s per user |
| `PRESENCE_IDLE_MS` | `60_000` | Planned: T7 alarm drops idle drafts/presence | D13: presence dropped after 60 s |
| `ALARM_INTERVAL_MS` | `30_000` | Planned: T7 `Room.alarm()` cadence | Sweeps idle state twice per idle window |
| `BAD_FRAME_STRIKES` | `10` | Planned: T7 (strikes before closing a socket) | Tolerates a few bad frames, stops a flood |
| `CLOSE_POLICY_VIOLATION` | `1008` | Planned: T7 close code after the strikes | RFC 6455 "policy violation" |
| `PING_INTERVAL_MS` | `30_000` | Planned: T14 client ping (DO auto-responds ping→pong) | Keeps idle sockets and proxies alive |
| `RECONNECT_BACKOFF_MS` | `{ min: 1000, max: 30_000 }` | Planned: T14 reconnect backoff (+ jitter) | Fast first retry, bounded worst case |
| `OFFLINE_POLL_MS` | `10_000` | Planned: T14 polling while the socket is offline | Degraded mode still converges |

## TIMEOUTS

| Name | Value | Where used | Why |
|---|---|---|---|
| `DB_CONNECT_MS` | `3000` | `apps/api/src/db/index.ts` `withClient` (`connectionTimeoutMillis`) | `/readyz` and requests fail fast when the DB is unreachable |
| `DB_QUERY_MS` | `3000` | `apps/api/src/db/index.ts` `withClient` (`query_timeout`) | Bounds one query inside the request budget |
| `REQUEST_MS` | `10_000` | Planned: T3 `timeout()` middleware → 504 `TIMEOUT` | Whole-request budget (§6) |

## ROUTES

| Name | Value | Where used | Why |
|---|---|---|---|
| `API_PREFIX` | `'/api'` | `apps/web/vite.config.ts` dev proxy | Everything under it goes to `wrangler dev` |
| `HEALTHZ` | `'/healthz'` | `apps/api/src/routes/health.ts` | Liveness |
| `READYZ` | `'/readyz'` | `apps/api/src/routes/health.ts` | Readiness (DB reachable) |
| `AUTH` | `'/api/auth'` | `apps/api/src/app.ts` (`${AUTH}/*` → `authHandler`); planned T12 auth client `baseURL` | Better Auth mount |
| `AREAS` | `'/api/areas'` | `apps/api/src/app.ts` (mounts `routes/areas.ts`); planned T13 fetch wrappers | Area CRUD + bbox query |
| `WS` | `'/ws'` | `apps/api/src/app.ts` (`wsUpgrade`), `apps/web/vite.config.ts` ws proxy; planned T14 | Room WebSocket upgrade |
| `OPENAPI` | `'/openapi.json'` | Planned: T15 `openAPIRouteHandler` | OpenAPI document |

## DEV

| Name | Value | Where used | Why |
|---|---|---|---|
| `API_ORIGIN` | `'http://localhost:8787'` | `apps/web/vite.config.ts` proxy target, `apps/api/vitest.config.ts` test `BETTER_AUTH_URL`, `.dev.vars.example` | `wrangler dev` default port |
| `WEB_ORIGIN` | `'http://localhost:5173'` | Mirrored by hand in `apps/api/wrangler.jsonc` `vars.CLIENT_ORIGIN` (JSON cannot import); `test/scaffold.test.ts` asserts they match | `vite` default port; CORS and Better Auth trusted origin |

## ROOM

| Name | Value | Where used | Why |
|---|---|---|---|
| `DEFAULT_ROOM_ID` | `'default'` | `apps/api/test/scaffold.test.ts`; planned T6 `ROOM.idFromName`, T8 fan-out | D11: one shared map, one Room DO |

## MAP

| Name | Value | Where used | Why |
|---|---|---|---|
| `DEFAULT_CENTER` | `[31.5, 34.9]` | Planned: T10 `L.map` center (Leaflet `[lat, lng]`) | Israel, the demo region |
| `DEFAULT_ZOOM` | `8` | Planned: T10 | Whole country visible |
| `OSM_TILE_URL` | `'https://tile.openstreetmap.org/{z}/{x}/{y}.png'` | Planned: T10 `L.tileLayer` | OSM standard tiles |
| `OSM_ATTRIBUTION` | `'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'` | Planned: T10 | Required by the OSM tile usage policy |
| `OSM_MAX_ZOOM` | `19` | Planned: T10 | Highest zoom OSM serves |
| `AREAS_PANE` / `AREAS_PANE_Z` | `'areas'` / `450` | Planned: T10 creates, T13 draws saved areas | Above tiles and Leaflet's overlay pane (400) |
| `DRAFTS_PANE` / `DRAFTS_PANE_Z` | `'drafts'` / `460` | Planned: T10 creates, T14 draws ghost drafts | Live drafts render above saved areas |
| `MOVEEND_DEBOUNCE_MS` | `250` | Planned: T13 bbox query on `moveend` | One fetch per pan gesture |

## ERROR_CODES

Every `ApiError.code` the API sends; `ApiErrorCodeSchema = z.enum(ERROR_CODES)`. `apps/api/src/errors.ts` `codeFor(status)` maps an `HTTPException` status onto these (`HTTP_<status>` when none fits).

| Name | Value | Where used | Why |
|---|---|---|---|
| `BAD_REQUEST` | `'BAD_REQUEST'` | `codeFor(400)`; planned T6 (426 non-upgrade), T7 bad frame | Malformed request |
| `UNAUTHORIZED` | `'UNAUTHORIZED'` | `codeFor(401)`; planned T5, T6 | No session |
| `FORBIDDEN` | `'FORBIDDEN'` | `codeFor(403)` | Reserved (D12: any signed-in user edits) |
| `NOT_FOUND` | `'NOT_FOUND'` | `apps/api/src/app.ts` `notFound`, `codeFor(404)`; planned T15 | Unknown route or area |
| `CONFLICT` | `'CONFLICT'` | `codeFor(409)`; planned T15 stale `version` | Optimistic concurrency |
| `UNPROCESSABLE` | `'UNPROCESSABLE'` | `codeFor(422)`; planned T15 Zod and `ST_IsValid` failures | Validation |
| `PAYLOAD_TOO_LARGE` | `'PAYLOAD_TOO_LARGE'` | `codeFor(413)` | Body limit |
| `RATE_LIMITED` | `'RATE_LIMITED'` | `codeFor(429)`; planned T7 draft bucket | D13 rate limits |
| `TIMEOUT` | `'TIMEOUT'` | `codeFor(504)`; planned T3 timeout middleware | Request budget exceeded |
| `NOT_READY` | `'NOT_READY'` | `apps/api/src/routes/health.ts` `/readyz` 503 | DB unreachable |
| `INTERNAL` | `'INTERNAL'` | `apps/api/src/app.ts` `onError` 500, T0 501 stubs (`auth.ts`, `ws.ts`) | Sanitised server error |

## ERROR_MESSAGES

| Name | Value | Where used | Why |
|---|---|---|---|
| `NOT_FOUND` | `'Not found'` | `apps/api/src/app.ts` `notFound` | Stable text clients and tests match |
| `INTERNAL` | `'Internal Server Error'` | `apps/api/src/app.ts` `onError` | 5xx bodies never leak `err.message` |
| `NOT_READY` | `'database unreachable'` | `apps/api/src/routes/health.ts` | `/readyz` 503 body |
| `UNAUTHORIZED` | `'sign in'` | Planned: T5 `requireUser`, T6 `wsUpgrade` | 401 body |
| `TIMEOUT` | `'timeout'` | Planned: T3 `HTTPException(504, { message })` | 504 body |
| `NOT_IMPLEMENTED` | `'not implemented'` | `apps/api/src/auth.ts`, `apps/api/src/ws.ts` (T0 stubs) | 501 until the lane fills the stub |
