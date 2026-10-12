# Constants

Single source of truth is `packages/shared/src/constants.ts`; this doc mirrors it. Add new values to both.

Import from `@cgis/shared` in app code (`@cgis/shared/constants` in Node-side config files such as `vite.config.ts` and `vitest.config.ts`). Lanes extend both files rather than writing literals. "Planned" names the M1 task that consumes a value.

Visual design tokens (spacing, type, colour ramps and semantic colours, map styles, radii, z-index, motion) live in one CSS file, [`apps/web/src/styles/tokens.css`](../apps/web/src/styles/tokens.css) (design system "Grid 4", D15–D18). The map pane z-indexes are defined here and mirrored there; `apps/web/src/styles/tokens.test.ts` fails when they drift. Presence hues are `MAP.PRESENCE_COLORS` only: the server hashes each user id into that palette and sends the colour, and the web applies it per element through the `--presence` CSS variable. The draw tool splits by who needs the value: Leaflet's numbers (`MAP.HANDLE_HIT_PX`, `MAP.DRAFT_STYLE`) live here; the handle dot and the sketch colours are CSS (`--map-handle-*`, `.cgis-draw-handle`, `.cgis-draw-sketch`).

## LIMITS

| Name | Value | Where used | Why |
|---|---|---|---|
| `POLYGON_MAX_VERTICES` | `1000` | `packages/shared/src/geo.ts` (ring max; re-exported under the old name), `apps/web/src/lib/geo/draw-handler.ts` (vertex cap) | Spec §5 polygon rule; bounds payload and `ST_IsValid` cost |
| `POLYGON_MAX_PLACED_VERTICES` | `POLYGON_MAX_VERTICES - 1` (`999`) | `apps/web/src/components/DrawControl.tsx` (`n / 999` vertex readout) | Positions minus the closing vertex: the cap the user can actually reach while drawing |
| `AREA_NAME_MAX` | `120` | `packages/shared/src/area.ts` (`AreaSchema.name`) | D13 name length cap |
| `USER_NAME_MAX` | `60` | `apps/api/src/do/handoff.ts` (Room trims and caps the user name), `apps/api/src/do/presence.ts` `PresenceAttachmentSchema.name` | Presence list and ghost labels stay short; attachments stay small |
| `USER_ID_MAX` | `128` | `apps/api/src/do/handoff.ts` (Room rejects longer ids with 400), `PresenceAttachmentSchema.userId`, `packages/shared/src/ws.ts` `draft:update` `payload.userId` (the author the Room stamps) | With both strings capped, a socket attachment cannot reach the runtime's 16 KiB limit |
| `BOUNDS_LIMIT` | `500` | `apps/api/src/db/spatial.ts` `selectAreasInBounds` default `limit`; `apps/api/src/services/areas.ts` `listAreas` (`GET /api/areas`) | Caps one viewport response |
| `SIMPLIFY_ZOOM_BELOW` | `12` | Unused in M1: `GET /api/areas` validates `zoom` and ignores it (T15 ruling: no simplification); planned M2 | Fewer vertices when zoomed out |
| `SIMPLIFY_TOLERANCE` | `0.0005` | Unused in M1 (see `SIMPLIFY_ZOOM_BELOW`); planned M2 `ST_SimplifyPreserveTopology` tolerance (degrees) | ~50 m at the equator: invisible at zoom < 12 |
| `PASSWORD_MIN` | `8` | `apps/web/src/routes/-components/AuthForm.tsx` (register `minlength`), `COPY.AUTH.PASSWORD_HINT` | Better Auth's default `minPasswordLength`; the form rejects what the server would |

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
| `CLOSE_IDLE` | `1001` | `apps/api/src/do/room.ts` `alarm()` closes a socket silent for `PRESENCE_IDLE_MS` (no frame and no auto-answered ping) | RFC 6455 "going away": a client that pings every `PING_INTERVAL_MS` is never reaped; one that stopped is dead, and reconnects if it is not |
| `PING_INTERVAL_MS` | `30_000` | Planned: T14 client ping (DO auto-responds ping→pong) | Keeps idle sockets and proxies alive |
| `AUTO_PING` / `AUTO_PONG` | `'ping'` / `'pong'` | `apps/api/src/do/room.ts` `setWebSocketAutoResponse`; planned T14 client ping | The runtime answers without waking a hibernated Room |
| `RECONNECT_BACKOFF_MS` | `{ min: 1000, max: 30_000 }` | Planned: T14 reconnect backoff (+ jitter) | Fast first retry, bounded worst case |
| `OFFLINE_POLL_MS` | `10_000` | Planned: T14 polling while the socket is offline | Degraded mode still converges |

## RATE_LIMIT

| Name | Value | Where used | Why |
|---|---|---|---|
| `DRAW_ACTIONS_PER_WINDOW` | `50` | `apps/api/src/do/rate-limiter.ts` `RateLimiter.take` (actions allowed per window); `apps/api/src/routes/areas.ts` mounts `rateLimit(ACTIONS.MUTATE)` on `POST`/`PUT`/`DELETE` (after `requireUser()`, before validation, so rejected attempts count); planned: T7/T8 Room calls `take` for WS drawing actions | D5: 50 drawing actions per user per window, one budget for REST and WS |
| `WINDOW_MS` | `60_000` | `apps/api/src/do/rate-limiter.ts` (sliding window length, prune cutoff, idle alarm) | D5: exact sliding window over the last 60 s; the 429 `Retry-After` is at most this long |
| `ACTIONS` | `{ DRAW: 'draw', MUTATE: 'mutate' }` | `apps/api/src/do/rate-limiter.ts` (`take` rejects any other value at runtime), type `RateLimitAction`; `apps/api/src/routes/areas.ts` `rateLimit(ACTIONS.MUTATE)` on area mutations; planned: T7/T8 Room `take(ACTIONS.DRAW)` per WS drawing action | RPC does not enforce TS types, so the limiter only stores known labels; both spend the one D5 budget |

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
| `AREAS` | `'/api/areas'` | `apps/api/src/app.ts` (mounts `routes/areas.ts`: `POST`, `GET ?bbox=`); planned T13 fetch wrappers | Area CRUD + bbox query |
| `AREA_BY_ID` | `'/:id'` | `apps/api/src/routes/areas.ts` (`PUT`/`DELETE`, relative to `AREAS`; `:id` validated as a UUID) | One area |
| `WS` | `'/ws'` | `apps/api/src/app.ts` (`wsUpgrade`), `apps/web/vite.config.ts` ws proxy; planned T14 | Room WebSocket upgrade |
| `OPENAPI` | `'/openapi.json'` | `apps/api/src/app.ts` `openAPIRouteHandler` (public; the `/docs` UI is M2) | OpenAPI 3.1 document of the routes with `describeRoute` metadata |
| `APP` | `{ HOME: '/', LOGIN: '/login', REGISTER: '/register', MAP: '/map' }` | `apps/web/src/routes/index.tsx` (`/` → `MAP`), `apps/web/src/routes/_authed.tsx` (signed out → `LOGIN`), `apps/web/src/routes/-components/redirectSignedIn.ts` (signed in on `/login` or `/register` → `MAP`), `AuthForm.tsx` (links between `LOGIN` and `REGISTER`) | SPA route targets for `redirect({ to })`, `<Link to>` and `navigate`; `createFileRoute('…')` ids stay literal because the router generates them from the file tree |

## DEV

| Name | Value | Where used | Why |
|---|---|---|---|
| `API_ORIGIN` | `'http://localhost:8787'` | `apps/web/vite.config.ts` proxy target, `apps/api/vitest.config.ts` test `BETTER_AUTH_URL`, `.dev.vars.example` | `wrangler dev` default port |
| `WEB_ORIGIN` | `'http://localhost:5173'` | Mirrored by hand in `apps/api/wrangler.jsonc` `vars.CLIENT_ORIGIN` (JSON cannot import); `test/scaffold.test.ts` asserts they match | `vite` default port; CORS and Better Auth trusted origin |

## HEADERS

| Name | Value | Where used | Why |
|---|---|---|---|
| `ORIGIN` | `'origin'` | `apps/api/src/ws.ts` `wsGate()` (the `GET /ws` Origin allow-list) | Browsers always send Origin on a WebSocket upgrade; the gate compares it with `env.CLIENT_ORIGIN` |
| `CF_CONNECTING_IP` | `'cf-connecting-ip'` | `apps/api/src/routes/areas.ts` (audit row `ip`) | The client IP Cloudflare sets on every request (D20) |
| `USER_AGENT` | `'user-agent'` | `apps/api/src/routes/areas.ts` (audit row `user_agent`) | D20 audit context |

## OPENAPI

| Name | Value | Where used | Why |
|---|---|---|---|
| `TITLE` | `'Collaborative GIS API'` | `apps/api/src/app.ts` `openAPIRouteHandler` `documentation.info.title` | Names the `/openapi.json` document |
| `VERSION` | `'0.1.0'` | `apps/api/src/app.ts` `documentation.info.version` | Document version; bump with breaking contract changes |

## AUDIT

`audit_log` vocabulary (D20): one row per user action; an area event's `(entity_id, version)` points at the `area_versions` row it produced (no payload hash, migration `0003_audit_version`).

| Name | Value | Where used | Why |
|---|---|---|---|
| `ENTITIES.AREA` | `'area'` | `apps/api/src/services/areas.ts` (`audit_log.entity`) | The audited entity kind |
| `ACTIONS.AREA_CREATE` | `'area.create'` | `apps/api/src/services/areas.ts` `createArea` (version 1) | Written in the same transaction as the insert |
| `ACTIONS.AREA_UPDATE` | `'area.update'` | `apps/api/src/services/areas.ts` `updateArea` (the new version) | Written in the same transaction as the update; a 409 writes none |
| `ACTIONS.AREA_DELETE` | `'area.delete'` | `apps/api/src/services/areas.ts` `deleteArea` (the version the soft delete bumped to) | Written in the same transaction as the soft delete |

## ROOM

| Name | Value | Where used | Why |
|---|---|---|---|
| `DEFAULT_ROOM_ID` | `'default'` | `apps/api/src/ws.ts` (`GET /ws` hand-off), `apps/api/src/services/fanout.ts` (area changes → `Room.broadcast`), `apps/api/test/scaffold.test.ts` | D11: one shared map, one Room DO |
| `USER_ID_HEADER` / `USER_NAME_HEADER` | `'x-user-id'` / `'x-user-name'` | `apps/api/src/do/handoff.ts`: `withRoomUser` (used by `ws.ts`) sets them, name percent-encoded; `readRoomUser` (used by `room.ts`) validates them | The Worker hands the session user to the Room; client-sent copies are overwritten |

## MAP

| Name | Value | Where used | Why |
|---|---|---|---|
| `DEFAULT_CENTER` | `[31.5, 34.9]` | Planned: T10 `L.map` center (Leaflet `[lat, lng]`) | Israel, the demo region |
| `DEFAULT_ZOOM` | `8` | Planned: T10 | Whole country visible |
| `OSM_TILE_URL` | `'https://tile.openstreetmap.org/{z}/{x}/{y}.png'` | Planned: T10 `L.tileLayer` | OSM standard tiles |
| `OSM_ATTRIBUTION` | `'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'` | Planned: T10 | Required by the OSM tile usage policy |
| `OSM_MAX_ZOOM` | `19` | Planned: T10 | Highest zoom OSM serves |
| `AREAS_PANE` / `AREAS_PANE_Z` | `'areas'` / `450` | `apps/web/src/ui/map-styles.ts` (path options), `tokens.css` `--z-index-map-areas` (drift-tested); planned: T10 creates, T13 draws saved areas | Above tiles and Leaflet's overlay pane (400) |
| `DRAFTS_PANE` / `DRAFTS_PANE_Z` | `'drafts'` / `460` | `apps/web/src/ui/map-styles.ts` (path options), `tokens.css` `--z-index-map-drafts` (drift-tested), `apps/web/src/components/DrawControl.tsx` (`PolygonDraw` pane for the own sketch); planned: T10 creates, T14 draws ghost drafts | Live drafts render above saved areas |
| `MOVEEND_DEBOUNCE_MS` | `250` | Planned: T13 bbox query on `moveend` | One fetch per pan gesture |
| `PRESENCE_COLORS` | `['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948']` | `apps/api/src/do/presence.ts` `presenceColor` (SHA-256 of the user id, mod 8) and `PresenceAttachmentSchema.color`; the web takes that colour per user (`Avatar color`, `ghostPathOptions(color)`); Storybook Foundations/Colour | The 8-hue CVD-checked presence palette from the design-system brief (Grid 4) |
| `HANDLE_HIT_PX` | `24` | `apps/web/src/lib/geo/draw-handler.ts` (vertex handle hit box, the `L.divIcon` size) | WCAG 2.5.8 target size (≥24 CSS px) for dragging a vertex. The dot's radius, ring and colours are CSS: `.cgis-draw-handle` / `.cgis-draw-handle--first` in the token stylesheet (T9b, PR #14) |
| `DRAFT_STYLE` | `{ weight: 2, dashArray: '8 4', fillOpacity: 0.12 }` | `apps/web/src/lib/geo/draw-handler.ts` (live sketch, class `cgis-draw-sketch`), `apps/web/src/ui/map-styles.ts` `draftPathOptions()`; Storybook Foundations/Map; planned T14 ghost drafts | Dashed and faint: reads as unsaved next to solid saved areas. Dash 8/4 is the design brief's §4 value. Stroke and fill colours are CSS on `.cgis-draw-sketch` |
| `AREA_KM2_THRESHOLD` | `1` | `apps/web/src/components/DrawControl.tsx` (area readout unit) | Below 1 km² the readout is whole m² (`12,345 m²`); from 1 km² it is km² to 3 decimals (`1.234 km²`, 1,000 m² resolution). Numbers use `Stat`'s user-locale formatter |

## DRAW

| Name | Value | Where used | Why |
|---|---|---|---|
| `SELF_INTERSECTION_REASON` | `'Polygon edges must not cross or touch each other'` | `draw-handler.ts` `draw:invalid` | Client mirror of the server's `ST_IsValid` rejection |
| `MAX_VERTICES_REASON` | `'Vertex limit reached'` | `draw-handler.ts` `draw:invalid` when a click would pass `LIMITS.POLYGON_MAX_VERTICES` | The cap counts the closing vertex, so the UI should not promise a number here |
| `TOOLBAR_LABEL` | `'Drawing tools'` | `apps/web/src/components/DrawControl.tsx` (idle `MapControl` toolbar name) | Names the toolbar landmark around the start button |
| `START_LABEL` | `'Draw polygon'` | `DrawControl.tsx` (icon button's tooltip and accessible name) | The one action while idle |
| `PANEL_TITLE` | `'New area'` | `DrawControl.tsx` (floating `Panel` heading and region name while drawing) | The sketch becomes an area when saved |
| `AREA_LABEL` / `VERTICES_LABEL` | `'Area'` / `'Vertices'` | `DrawControl.tsx` (`Stat` labels of the live readout) | Visible labels; also the readouts' accessible names |
| `FINISH_LABEL` / `UNDO_LABEL` / `CANCEL_LABEL` | `'Finish'` / `'Undo'` / `'Cancel'` | `DrawControl.tsx` (panel footer buttons → `finish()` / `undo()` / `cancel()`) | Pointer equivalents of Enter / Backspace / Escape |
| `M2_UNIT` / `KM2_UNIT` | `'m²'` / `'km²'` | `DrawControl.tsx` (area `Stat` unit) | `Intl.NumberFormat` has no area units (ECMA-402 sanctions length units only) |

## COPY

User-facing text in the SPA, one group per screen. Components read it from here instead of writing literals.

| Name | Value | Where used |
|---|---|---|
| `APP.NAME` | `'Collaborative GIS'` | `apps/web/src/routes/-components/AppFrame.tsx` header |
| `AUTH.LOGIN_TITLE` / `AUTH.REGISTER_TITLE` | `'Sign in'` / `'Create an account'` | `AuthForm` panel heading |
| `AUTH.LOGIN_SUBMIT` / `AUTH.REGISTER_SUBMIT` | `'Sign in'` / `'Create account'` | `AuthForm` submit button |
| `AUTH.LOGIN_PENDING` / `AUTH.REGISTER_PENDING` | `'Signing in…'` / `'Creating account…'` | `AuthForm` submit button while the request runs |
| `AUTH.LOGIN_ERROR_TITLE` / `AUTH.REGISTER_ERROR_TITLE` | `'Could not sign in'` / `'Could not create the account'` | `AuthForm` error banner title |
| `AUTH.LOGIN_SWITCH_PROMPT` / `AUTH.LOGIN_SWITCH_LINK` | `'No account yet?'` / `'Create one'` | `/login` footer link to `/register` |
| `AUTH.REGISTER_SWITCH_PROMPT` / `AUTH.REGISTER_SWITCH_LINK` | `'Already have an account?'` / `'Sign in'` | `/register` footer link to `/login` |
| `AUTH.NAME_LABEL` / `AUTH.EMAIL_LABEL` / `AUTH.PASSWORD_LABEL` | `'Name'` / `'Email'` / `'Password'` | `AuthForm` field labels |
| `AUTH.PASSWORD_HINT` | `` `At least ${LIMITS.PASSWORD_MIN} characters.` `` | `AuthForm` register password hint |
| `AUTH.ERROR_GENERIC` | `'Something went wrong. Try again.'` | `apps/web/src/lib/auth.ts` (`AuthError` without a server message, `authErrorMessage` for anything else) |
| `AUTH.SIGN_OUT` | `'Sign out'` | `AppFrame.tsx` `SessionMenu` button |
| `AUTH.SIGN_OUT_ERROR` | `'Could not sign out. Try again.'` | `SessionMenu` alert when sign-out fails and the session is still valid |

## ERROR_CODES

Every `ApiError.code` the API sends; `ApiErrorCodeSchema = z.enum(ERROR_CODES)`. `apps/api/src/errors.ts` holds the code → HTTP status table (`satisfies Record<ApiErrorCode, …>`, so a code added here without a status fails the build), one helper per code (`notFoundError(c, message?, details?)`, …), and `codeFor(status)` for a thrown `HTTPException` (`HTTP_<status>` when no code fits).

| Name | Value | Status | Where used | Why |
|---|---|---|---|---|
| `BAD_REQUEST` | `'BAD_REQUEST'` | 400 | `badRequestError`; planned T7 bad frame | Malformed request |
| `UNAUTHORIZED` | `'UNAUTHORIZED'` | 401 | `unauthorizedError`: `apps/api/src/middleware/require-user.ts` `requireUser()` (also first in `GET /ws`) | No session |
| `FORBIDDEN` | `'FORBIDDEN'` | 403 | `forbiddenError`: `apps/api/src/ws.ts` `wsGate()` with `ERROR_REASONS.ORIGIN_NOT_ALLOWED` | Foreign or missing Origin on `GET /ws`; not for edit rights (D12: any signed-in user edits) |
| `NOT_FOUND` | `'NOT_FOUND'` | 404 | `apps/api/src/app.ts` `notFound`; `apps/api/src/routes/areas.ts` (`PUT`/`DELETE` of a missing or deleted area) | Unknown route or area |
| `CONFLICT` | `'CONFLICT'` | 409 | `conflictError`; `apps/api/src/routes/areas.ts` `PUT` with a stale `version` (`details.current`) | Optimistic concurrency |
| `UNPROCESSABLE` | `'UNPROCESSABLE'` | 422 | `unprocessableError`; `apps/api/src/validate.ts` (schema failures, `details.issues`), `apps/api/src/routes/areas.ts` (`ST_IsValid` failures, `details.reason`) | Validation |
| `PAYLOAD_TOO_LARGE` | `'PAYLOAD_TOO_LARGE'` | 413 | `payloadTooLargeError` | Body limit |
| `RATE_LIMITED` | `'RATE_LIMITED'` | 429 | `rateLimitedError`: `apps/api/src/middleware/rate-limit.ts` (area mutations); planned T7 draft bucket | D13 rate limits |
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
| `UNAUTHORIZED` | `'sign in'` | `unauthorizedError` default: `requireUser()` | 401 body clients match |
| `FORBIDDEN` | `'Forbidden'` | `forbiddenError` default | Generic 403 |
| `NOT_FOUND` | `'Not found'` | `apps/api/src/app.ts` `notFound` | Stable 404 body |
| `CONFLICT` | `'Conflict'` | `conflictError` default; the area routes send `ERROR_REASONS.VERSION_CONFLICT` | Generic 409 |
| `UNPROCESSABLE` | `'Unprocessable'` | `unprocessableError` default; `apps/api/src/validate.ts` (schema failures) | Generic 422 |
| `PAYLOAD_TOO_LARGE` | `'Payload too large'` | `payloadTooLargeError` default | Generic 413 |
| `RATE_LIMITED` | `'Too many requests'` | `rateLimitedError` default | Generic 429 |
| `TIMEOUT` | `'timeout'` | `apps/api/src/middleware/index.ts` `HTTPException(504, { message: ERROR_MESSAGES.TIMEOUT })` | 504 body |
| `NOT_READY` | `'database unreachable'` | `apps/api/src/routes/health.ts` | `/readyz` 503 body |
| `INTERNAL` | `'Internal Server Error'` | `apps/api/src/app.ts` `onError` | 5xx bodies never leak `err.message` |
| `NOT_IMPLEMENTED` | `'not implemented'` | T0 stubs `auth.ts`, `ws.ts` | 501 until the lane fills the stub |
| `UPGRADE_REQUIRED` | `'websocket upgrade required'` | Planned: T6 | 426 body |

## ERROR_REASONS

`ApiError.message`s more specific than their code's default; `ERROR_MESSAGES` keeps exactly the `ERROR_CODES` keys, so route-specific text lives here.

| Name | Value | Code | Where used | Why |
|---|---|---|---|---|
| `ORIGIN_NOT_ALLOWED` | `'origin not allowed'` | `FORBIDDEN` (403) | `apps/api/src/ws.ts` `wsGate()`: a `GET /ws` upgrade whose Origin is missing or is not `env.CLIENT_ORIGIN` | Cross-site WebSocket hijacking: Better Auth's `getSession` ignores Origin, so without this a foreign page could open a socket with the victim's cookie |
| `INVALID_GEOMETRY` | `'invalid geometry'` | `UNPROCESSABLE` (422) | `apps/api/src/routes/areas.ts`: `POST`/`PUT` whose polygon passed Zod but failed `ST_IsValid`; `details.reason` is the `ST_IsValidReason` text | Tells the client the geometry, not the request shape, is at fault |
| `VERSION_CONFLICT` | `'version conflict'` | `CONFLICT` (409) | `apps/api/src/routes/areas.ts` `PUT`: the stored `version` is not the one sent; `details.current` is the stored area | The client can show the current area and let the user re-apply |

## WS_MESSAGES

`error` frame messages the Room sends beside the `ERROR_CODES` code, where the `ERROR_MESSAGES` default says too little. Clients branch on the code, never on the message.

| Name | Value | Where used | Why |
|---|---|---|---|
| `NOT_JSON` | `'frames must be JSON text'` | `apps/api/src/do/room.ts` (binary or non-JSON frame → `BAD_REQUEST`, one strike) | Says what the Room accepts; a schema failure sends Zod's issue text instead |
| `NOT_JOINED` | `'send join first'` | `apps/api/src/do/room.ts` (`draft:update` before `join` → `BAD_REQUEST`, no strike) | Drafts come only from users in presence |
| `DRAFT_OP_MISFIT` | `'draft op does not fit the current draft'` | `apps/api/src/do/room.ts` (index past the end, or an `add` beyond `LIMITS.POLYGON_MAX_VERTICES` → `BAD_REQUEST`, no strike) | The client's draft and the Room's have diverged; the op is not relayed |
