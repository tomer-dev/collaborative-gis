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
| `DB_CONNECT_MS` | `3000` | `apps/api/src/db/index.ts` `withClient`: `connectionTimeoutMillis` and a hard `Promise.race` deadline (workerd cannot abort a TCP connect in flight) | `/readyz` and every DB call fail fast when the DB is unreachable |
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
| `HANDLE_RADIUS_PX` | `6` | `apps/web/src/lib/geo/draw-handler.ts` (visible vertex dot radius) | Small enough not to hide the edge, big enough to see |
| `HANDLE_HIT_PX` | `24` | `apps/web/src/lib/geo/draw-handler.ts` (vertex handle hit box, the marker icon size) | WCAG 2.5.8 target size (≥24 CSS px) for dragging a vertex |
| `HANDLE_BORDER_PX` | `2` | `apps/web/src/lib/geo/draw-handler.ts` (vertex dot ring) | Ring stays visible over busy tiles |
| `DRAFT_STYLE` | `{ weight: 2, dashArray: '6 4', fillOpacity: 0.12 }` | `apps/web/src/lib/geo/draw-handler.ts` (live sketch); planned T14 ghost drafts | Dashed and faint: reads as unsaved next to solid saved areas |

## GEO

| Name | Value | Where used | Why |
|---|---|---|---|
| `EARTH_RADIUS_M` | `6371008.8` | `apps/web/src/lib/geo/geodesic.ts` (`ringAreaM2`, spherical excess) | WGS84 mean radius R1 = (2a + b) / 3. Versus the server's spheroidal `ST_Area(geography)` the sphere reads +0.13% at 29°N, +0.07% at 32°N, +0.03% at 34°N (Israel), +0.45% at the equator, −0.56% at 60°N (T11a report) |

## DRAW

| Name | Value | Where used | Why |
|---|---|---|---|
| `ARIA_LABEL` | `'Polygon drawing. Click to add a vertex, …, Escape to cancel.'` | `apps/web/src/lib/geo/draw-handler.ts` (map container `aria-label` while drawing) | The container is `role="application"`; the label announces the gestures and keys |
| `SELF_INTERSECTION_REASON` | `'Polygon edges must not cross or touch each other'` | `draw-handler.ts` `draw:invalid` | Client mirror of the server's `ST_IsValid` rejection |
| `MAX_VERTICES_REASON` | `'Vertex limit reached'` | `draw-handler.ts` `draw:invalid` when a click would pass `LIMITS.POLYGON_MAX_VERTICES` | The cap counts the closing vertex, so the UI should not promise a number here |

## ERROR_CODES

Every `ApiError.code` the API sends; `ApiErrorCodeSchema = z.enum(ERROR_CODES)`. `apps/api/src/errors.ts` holds the code → HTTP status table (`satisfies Record<ApiErrorCode, …>`, so a code added here without a status fails the build), one helper per code (`notFoundError(c, message?, details?)`, …), and `codeFor(status)` for a thrown `HTTPException` (`HTTP_<status>` when no code fits).

| Name | Value | Status | Where used | Why |
|---|---|---|---|---|
| `BAD_REQUEST` | `'BAD_REQUEST'` | 400 | `badRequestError`; planned T7 bad frame | Malformed request |
| `UNAUTHORIZED` | `'UNAUTHORIZED'` | 401 | `unauthorizedError`; planned T5 `requireUser`, T6 | No session |
| `FORBIDDEN` | `'FORBIDDEN'` | 403 | `forbiddenError` | Reserved (D12: any signed-in user edits) |
| `NOT_FOUND` | `'NOT_FOUND'` | 404 | `apps/api/src/app.ts` `notFound`; planned T15 | Unknown route or area |
| `CONFLICT` | `'CONFLICT'` | 409 | `conflictError`; planned T15 stale `version` | Optimistic concurrency |
| `UNPROCESSABLE` | `'UNPROCESSABLE'` | 422 | `unprocessableError`; planned T15 Zod and `ST_IsValid` failures | Validation |
| `PAYLOAD_TOO_LARGE` | `'PAYLOAD_TOO_LARGE'` | 413 | `payloadTooLargeError` | Body limit |
| `RATE_LIMITED` | `'RATE_LIMITED'` | 429 | `rateLimitedError`; planned T7 draft bucket | D13 rate limits |
| `TIMEOUT` | `'TIMEOUT'` | 504 | `codeFor(504)`; planned T3 timeout middleware | Request budget exceeded |
| `NOT_READY` | `'NOT_READY'` | 503 | `apps/api/src/routes/health.ts` `/readyz` | DB unreachable |
| `INTERNAL` | `'INTERNAL'` | 500 | `apps/api/src/app.ts` `onError` | Sanitised server error |
| `NOT_IMPLEMENTED` | `'NOT_IMPLEMENTED'` | 501 | T0 stubs `apps/api/src/auth.ts`, `apps/api/src/ws.ts` | Mounted route whose lane has not landed |
| `UPGRADE_REQUIRED` | `'UPGRADE_REQUIRED'` | 426 | Planned: T6 `wsUpgrade` without `Upgrade: websocket` | `/ws` only speaks WebSocket |

## ERROR_MESSAGES

Default `ApiError.message` per code, same keys as `ERROR_CODES` (`satisfies` + a test keep them aligned). Each `errors.ts` helper uses it when no message is passed.

| Name | Value | Where used | Why |
|---|---|---|---|
| `BAD_REQUEST` | `'Bad request'` | `badRequestError` default | Generic 400 |
| `UNAUTHORIZED` | `'sign in'` | `unauthorizedError` default; planned T5, T6 | 401 body clients match |
| `FORBIDDEN` | `'Forbidden'` | `forbiddenError` default | Generic 403 |
| `NOT_FOUND` | `'Not found'` | `apps/api/src/app.ts` `notFound` | Stable 404 body |
| `CONFLICT` | `'Conflict'` | `conflictError` default; T15 passes its own text | Generic 409 |
| `UNPROCESSABLE` | `'Unprocessable'` | `unprocessableError` default | Generic 422 |
| `PAYLOAD_TOO_LARGE` | `'Payload too large'` | `payloadTooLargeError` default | Generic 413 |
| `RATE_LIMITED` | `'Too many requests'` | `rateLimitedError` default | Generic 429 |
| `TIMEOUT` | `'timeout'` | Planned: T3 `HTTPException(504, { message: ERROR_MESSAGES.TIMEOUT })` | 504 body |
| `NOT_READY` | `'database unreachable'` | `apps/api/src/routes/health.ts` | `/readyz` 503 body |
| `INTERNAL` | `'Internal Server Error'` | `apps/api/src/app.ts` `onError` | 5xx bodies never leak `err.message` |
| `NOT_IMPLEMENTED` | `'not implemented'` | T0 stubs `auth.ts`, `ws.ts` | 501 until the lane fills the stub |
| `UPGRADE_REQUIRED` | `'websocket upgrade required'` | Planned: T6 | 426 body |
