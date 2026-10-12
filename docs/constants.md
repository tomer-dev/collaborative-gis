# Constants

Single source of truth is `packages/shared/src/constants.ts`; this doc mirrors it. Add new values to both.

Import from `@cgis/shared` in app code (`@cgis/shared/constants` in Node-side config files such as `vite.config.ts` and `vitest.config.ts`). Lanes extend both files rather than writing literals. "Planned" names the M1 task that consumes a value.

## LIMITS

| Name | Value | Where used | Why |
|---|---|---|---|
| `POLYGON_MAX_VERTICES` | `1000` | `packages/shared/src/geo.ts` (ring max; re-exported under the old name), `apps/web/src/lib/geo/draw-handler.ts` (`maxVertices` default) | Spec §5 polygon rule; bounds payload and `ST_IsValid` cost |
| `POLYGON_MAX_PLACED_VERTICES` | `POLYGON_MAX_VERTICES - 1` (`999`) | `apps/web/src/lib/geo/draw-handler.ts` (vertex cap on `editable:drawing:click`); planned T11b `DrawControl` readout | Positions minus the closing vertex: the cap the user can actually reach while drawing |
| `AREA_NAME_MAX` | `120` | `packages/shared/src/area.ts` (`AreaSchema.name`) | D13 name length cap |
| `USER_NAME_MAX` | `60` | `apps/api/src/do/handoff.ts` (Room trims and caps the user name), `apps/api/src/do/presence.ts` `PresenceAttachmentSchema.name` | Presence list and ghost labels stay short; attachments stay small |
| `USER_ID_MAX` | `128` | `apps/api/src/do/handoff.ts` (Room rejects longer ids with 400), `PresenceAttachmentSchema.userId` | With both strings capped, a socket attachment cannot reach the runtime's 16 KiB limit |
| `BOUNDS_LIMIT` | `500` | `apps/api/src/db/spatial.ts` `selectAreasInBounds` default `limit`; planned: T15 `GET /api/areas` | Caps one viewport response |
| `SIMPLIFY_ZOOM_BELOW` | `12` | Planned: T15 (zoom below this gets simplified geometry) | Fewer vertices when zoomed out |
| `SIMPLIFY_TOLERANCE` | `0.0005` | Planned: T15 / T2 `ST_SimplifyPreserveTopology` tolerance (degrees) | ~50 m at the equator: invisible at zoom < 12 |

## GEO

| Name | Value | Where used | Why |
|---|---|---|---|
| `SRID` | `4326` | `apps/api/src/db/geometry.ts` (`geometry(Polygon,4326)` column type), `apps/api/src/db/spatial.ts` (`ST_MakeEnvelope(w, s, e, n, SRID)`) | WGS 84 lng/lat: what the map and GeoJSON use (`ST_GeomFromGeoJSON` defaults to it) |
| `EARTH_RADIUS_M` | `6371008.8` | `apps/web/src/lib/geo/geodesic.test.ts` (exact-sphere and L'Huilier references); equals `earthRadius` in `@turf/helpers`, which `@turf/area` uses in `ringAreaM2` | WGS84 mean radius R1 = (2a + b) / 3. Versus the server's spheroidal `ST_Area(geography)` the sphere reads +0.13% at 29°N, +0.07% at 32°N, +0.03% at 34°N (Israel), +0.45% at the equator, −0.56% at 60°N (T11a report) |

## SEED

The small test seed in `apps/api/src/db/seed.ts` (`seedAreas`); the 10k benchmark seed is M2.

| Name | Value | Where used | Why |
|---|---|---|---|
| `COUNT` | `50` | `seedAreas` default; `apps/api/test/db/spatial.test.ts` (rows before `ANALYZE` + `EXPLAIN`) | Enough rows for the planner to have statistics, fast to insert |
| `BBOX` | `[34.27, 29.49, 35.9, 33.34]` | `seedAreas` default | Israel as `[w, s, e, n]`, the demo region |
| `MAX_RADIUS_DEG` | `0.02` | `seedAreas` | Polygons up to ~4 km across: viewport-sized at city zoom |
| `VERTICES` | `{ min: 4, max: 8 }` | `seedAreas` | Small, varied rings |
| `USER_ID` | `'seed'` | `seedAreas` default `created_by` | Seeded rows are recognisable |

## WS

| Name | Value | Where used | Why |
|---|---|---|---|
| `DRAFT_RATE_PER_SEC` | `10` | Planned: T7 token bucket, T14 client throttle | D13: drafts ≤ 10 msg/s per user |
| `PRESENCE_IDLE_MS` | `60_000` | Planned: T7 alarm drops idle drafts/presence | D13: presence dropped after 60 s |
| `ALARM_INTERVAL_MS` | `30_000` | Planned: T7 `Room.alarm()` cadence | Sweeps idle state twice per idle window |
| `BAD_FRAME_STRIKES` | `10` | Planned: T7 (strikes before closing a socket) | Tolerates a few bad frames, stops a flood |
| `CLOSE_POLICY_VIOLATION` | `1008` | Planned: T7 close code after the strikes | RFC 6455 "policy violation" |
| `CLOSE_INTERNAL_ERROR` | `1011` | `apps/api/src/do/room.ts` closes an open socket without a valid attachment | RFC 6455 "internal error": the server cannot attribute the socket |
| `PING_INTERVAL_MS` | `30_000` | Planned: T14 client ping (DO auto-responds ping→pong) | Keeps idle sockets and proxies alive |
| `AUTO_PING` / `AUTO_PONG` | `'ping'` / `'pong'` | `apps/api/src/do/room.ts` `setWebSocketAutoResponse`; planned T14 client ping | The runtime answers without waking a hibernated Room |
| `RECONNECT_BACKOFF_MS` | `{ min: 1000, max: 30_000 }` | Planned: T14 reconnect backoff (+ jitter) | Fast first retry, bounded worst case |
| `OFFLINE_POLL_MS` | `10_000` | Planned: T14 polling while the socket is offline | Degraded mode still converges |

## RATE_LIMIT

| Name | Value | Where used | Why |
|---|---|---|---|
| `DRAW_ACTIONS_PER_WINDOW` | `50` | `apps/api/src/do/rate-limiter.ts` `RateLimiter.take` (actions allowed per window); planned: api lane mounts `rateLimit(action)` on mutations, T7/T8 Room calls `take` for WS drawing actions | D5: 50 drawing actions per user per window, one budget for REST and WS |
| `WINDOW_MS` | `60_000` | `apps/api/src/do/rate-limiter.ts` (sliding window length, prune cutoff, idle alarm) | D5: exact sliding window over the last 60 s; the 429 `Retry-After` is at most this long |
| `ACTIONS` | `{ DRAW: 'draw', MUTATE: 'mutate' }` | `apps/api/src/do/rate-limiter.ts` (`take` rejects any other value at runtime), type `RateLimitAction`; planned: api lane `rateLimit(ACTIONS.MUTATE)` on area mutations, T7/T8 Room `take(ACTIONS.DRAW)` per WS drawing action | RPC does not enforce TS types, so the limiter only stores known labels; both spend the one D5 budget |

## TIMEOUTS

| Name | Value | Where used | Why |
|---|---|---|---|
| `DB_CONNECT_MS` | `3000` | `apps/api/src/db/index.ts` `withClient`: `connectionTimeoutMillis` and a hard `Promise.race` deadline (workerd cannot abort a TCP connect in flight) | `/readyz` and every DB call fail fast when the DB is unreachable |
| `DB_QUERY_MS` | `3000` | `apps/api/src/db/index.ts` `withClient` (`query_timeout`) | Bounds one query inside the request budget |
| `REQUEST_MS` | `10_000` | `apps/api/src/middleware/index.ts` `timeout()` → 504 `TIMEOUT` | Whole-request budget (§6) |

## LOG

| Name | Value | Where used | Why |
|---|---|---|---|
| `REDACT_KEYS` | `['password', 'secret', 'cookie', 'authorization']` | `apps/api/src/middleware/logger.ts` `log()`: a key containing one of these (any case, any depth) is redacted | Spec §6: secrets never reach Workers Logs (`set-cookie`, `BETTER_AUTH_SECRET`, `Authorization` all match) |
| `REDACTED` | `'[redacted]'` | `apps/api/src/middleware/logger.ts` | Replacement value; keeps the key so the log still shows the field was present |

## ROUTES

| Name | Value | Where used | Why |
|---|---|---|---|
| `API_PREFIX` | `'/api'` | `apps/web/vite.config.ts` dev proxy | Everything under it goes to `wrangler dev` |
| `HEALTHZ` | `'/healthz'` | `apps/api/src/routes/health.ts` | Liveness |
| `READYZ` | `'/readyz'` | `apps/api/src/routes/health.ts` | Readiness (DB reachable) |
| `AUTH` | `'/api/auth'` | `apps/api/src/app.ts` (`${AUTH}/*` → `authHandler`); `apps/web/src/lib/auth-client.ts` (`createAuthClient({ basePath })`; `baseURL` must be an absolute origin, so it is omitted and the client uses the page origin) | Better Auth mount |
| `AREAS` | `'/api/areas'` | `apps/api/src/app.ts` (mounts `routes/areas.ts`); planned T13 fetch wrappers | Area CRUD + bbox query |
| `WS` | `'/ws'` | `apps/api/src/app.ts` (`wsUpgrade`), `apps/web/vite.config.ts` ws proxy; planned T14 | Room WebSocket upgrade |
| `OPENAPI` | `'/openapi.json'` | Planned: T15 `openAPIRouteHandler` | OpenAPI document |
| `APP` | `{ HOME: '/', LOGIN: '/login', REGISTER: '/register', MAP: '/map' }` | `apps/web/src/routes/index.tsx` (`/` → `MAP`), `apps/web/src/routes/_authed.tsx` (signed out → `LOGIN`); planned T12 login/register navigation (`REGISTER`) | SPA route targets for `redirect({ to })`, `<Link to>` and `navigate`; `createFileRoute('…')` ids stay literal because the router generates them from the file tree |

## DEV

| Name | Value | Where used | Why |
|---|---|---|---|
| `API_ORIGIN` | `'http://localhost:8787'` | `apps/web/vite.config.ts` proxy target, `apps/api/vitest.config.ts` test `BETTER_AUTH_URL`, `.dev.vars.example` | `wrangler dev` default port |
| `WEB_ORIGIN` | `'http://localhost:5173'` | Mirrored by hand in `apps/api/wrangler.jsonc` `vars.CLIENT_ORIGIN` (JSON cannot import); `test/scaffold.test.ts` asserts they match | `vite` default port; CORS and Better Auth trusted origin |

## ROOM

| Name | Value | Where used | Why |
|---|---|---|---|
| `DEFAULT_ROOM_ID` | `'default'` | `apps/api/test/scaffold.test.ts`; planned T6 `ROOM.idFromName`, T8 fan-out | D11: one shared map, one Room DO |
| `USER_ID_HEADER` / `USER_NAME_HEADER` | `'x-user-id'` / `'x-user-name'` | `apps/api/src/do/handoff.ts`: `withRoomUser` (used by `ws.ts`) sets them, name percent-encoded; `readRoomUser` (used by `room.ts`) validates them | The Worker hands the session user to the Room; client-sent copies are overwritten |

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
| `PRESENCE_COLORS` | `['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948']` | `apps/api/src/do/presence.ts` `presenceColor` (SHA-256 of the user id, mod 8) and `PresenceAttachmentSchema.color`; planned T14 ghosts and presence list | The 8-hue CVD-checked presence palette from the design-system brief (Grid 4) |
| `HANDLE_HIT_PX` | `24` | `apps/web/src/lib/geo/draw-handler.ts` (Leaflet.Editable vertex icon size, via its `createVertexIcon` hook) | WCAG 2.5.8 target size (≥24 CSS px) for dragging a vertex. The dot's radius, ring and colours are CSS: `.cgis-draw-handle` in the token stylesheet (T9b, PR #14) |
| `DRAFT_STYLE` | `{ weight: 2, dashArray: '6 4', fillOpacity: 0.12 }` | `apps/web/src/lib/geo/draw-handler.ts` (`editTools.startPolygon` options, class `cgis-draw-sketch`); planned T14 ghost drafts | Dashed and faint: reads as unsaved next to solid saved areas. Stroke and fill colours are CSS on `.cgis-draw-sketch` |

## DRAW

| Name | Value | Where used | Why |
|---|---|---|---|
| `SELF_INTERSECTION_REASON` | `'Polygon edges must not cross or touch each other'` | `draw-handler.ts` `draw:invalid` | Client mirror of the server's `ST_IsValid` rejection |
| `MAX_VERTICES_REASON` | `'Vertex limit reached'` | `draw-handler.ts` `draw:invalid` when a click would pass `LIMITS.POLYGON_MAX_PLACED_VERTICES` | The cap counts the closing vertex, so the UI should not promise a number here |

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
| `TIMEOUT` | `'TIMEOUT'` | 504 | `codeFor(504)` for the `apps/api/src/middleware/index.ts` timeout | Request budget exceeded |
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
| `TIMEOUT` | `'timeout'` | `apps/api/src/middleware/index.ts` `HTTPException(504, { message: ERROR_MESSAGES.TIMEOUT })` | 504 body |
| `NOT_READY` | `'database unreachable'` | `apps/api/src/routes/health.ts` | `/readyz` 503 body |
| `INTERNAL` | `'Internal Server Error'` | `apps/api/src/app.ts` `onError` | 5xx bodies never leak `err.message` |
| `NOT_IMPLEMENTED` | `'not implemented'` | T0 stubs `auth.ts`, `ws.ts` | 501 until the lane fills the stub |
| `UPGRADE_REQUIRED` | `'websocket upgrade required'` | Planned: T6 | 426 body |
