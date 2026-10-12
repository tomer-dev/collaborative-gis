# Research notes (pre-roadmap)

Date: 2026-10-12. Sources: Context7 docs, official sites. Each note states the fact and the roadmap decision it drives.

## PostGIS (postgis.net)
- `ST_Area(geography, use_spheroid=true)` returns square meters on the spheroid (GeographicLib). Divide by 1e6 for km². Geometry variant returns planar units of the SRID, which is "nonsense" for lat/lng. → Store `geometry(Polygon,4326)`, compute area as `ST_Area(geom::geography)`. Geometry with SRID 4326 autocasts to geography.
- `ST_IsValid` / `ST_IsValidReason` / `ST_IsValidDetail` detect self-intersection and ring problems via GEOS. → Server validates with `ST_IsValid` and rejects with the reason; client pre-checks ring closure and vertex cap.
- GiST R-tree index recommended once a table exceeds a few thousand rows; `&&` and `ST_Intersects` use it automatically. `VACUUM ANALYZE` after index build; `CREATE INDEX CONCURRENTLY` in production. → GiST on `areas.geom`; viewport query `geom && ST_MakeEnvelope(w,s,e,n,4326)`; benchmark with 10k+ seeded polygons.
- Geography is costlier per op than geometry. → Keep geometry for index/filter; cast to geography only for measurement.

## Leaflet (leafletjs.com, read 2026-10-12: reference, download, 2.0 blog, tutorials: layers-control, geojson, zoom-levels, map-panes, wms, accessibility, extending 1 & 3)
- **Versions:** stable **1.9.4** (May 2023); **2.0.0-alpha.1** (Aug 2025) is ESM-only, drops the `L` global and all factory functions (`new Marker()` instead of `L.marker()`), replaces mouse/touch events with pointer events (`pointermove`, `bubblingPointerEvents`), removes many `DomUtil`/`Util` helpers, renames `TouchZoom`→`PinchZoom`. Plugins relying on `L`, factories or mouse events break; a community "Leaflet V1 polyfill" exists. No stable date given.
- **Proj4Leaflet** (kartena): last release 1.0.1 (2017), npm 1.0.2; open issue #190 "Leaflet V2.0 coming soon" with no fix. → **Decision: Leaflet 1.9.4** for this project. Spike option A should prefer a hand-rolled CRS built directly on `proj4` (a CRS is `{projection:{project,unproject,bounds}, transformation:new Transformation(a,b,c,d), scale(z), zoom(s), code, infinite}`) over the unmaintained plugin; keeps a later 2.0 upgrade possible.
- **CRS model:** map has one `crs` fixed at construction. `CRS.scale(zoom)` = `256·2^zoom` for Mercator; custom tile grids override `scale`/`zoom` with a resolutions table. `Projection.project/unproject` take `LatLng`/`Point` instances only. `Transformation(a,b,c,d)` maps projected → pixel. Built-ins: EPSG3857 (default), EPSG4326, EPSG3395, Simple.
- **Tiles:** `TileLayer(urlTemplate, {opacity, maxZoom, bounds, tms, crossOrigin})`; `setOpacity`, `setUrl`, `setZIndex`; subclass and override `getTileUrl(coords)` for non-XYZ schemes (needed for govmap `L{level}/R{row}/C{col}` hex paths). `WMSTileLayer`/`TileLayer.WMS` uses the map CRS. TMS via `tms:true` or `{-y}`.
- **Vectors:** `Polygon(latlngs, options)` (do not repeat the first point), `setLatLngs/getLatLngs/addLatLng/getBounds/isEmpty/toGeoJSON`; Path options (`color`, `weight`, `fillOpacity`, `dashArray`, `className`, `renderer`); GeoJSON is lng,lat, Leaflet is lat,lng (`GeoJSON.coordsToLatLng`). `GeoJSON` layer with `style`, `onEachFeature`, `pointToLayer`, `filter`, `addData`.
- **Events:** map `click`, `dblclick`, `mousemove` (1.9) / `pointermove` (2.0), `moveend`, `zoomend`; click is suppressed after a >3 px drag; `baselayerchange` from `LayersControl` (`LayersControlEvent {layer, name}`); layers fire `add`/`remove`.
- **Panes:** z-order tile < overlay (paths) < shadow < marker < tooltip < popup; `map.createPane(name)` + `pane:` option; set `pointerEvents:none` on non-interactive panes. Draft/ghost polygons go in a dedicated pane above saved areas.
- **Handlers/Controls:** `Handler` subclass with `addHooks()/removeHooks()`, `map.addHandler('draw', DrawHandler)`, `map.draw.enable()/disable()`; `Control` with `onAdd()` returning an element and `DomEvent.on/off`. → The hand-rolled draw tool is a `Handler`; the layer switch is a `Control`.
- **Zoom:** `zoomSnap` (default 1), `zoomDelta`, fractional zoom loads integer tiles and scales them; `GridLayer` always requests integer `{z}`.
- **Accessibility:** container and markers keyboard-operable by default; give markers `alt`; decorative maps `inert`; retest after adding plugins; custom interactions need keyboard equivalents (our draw tool: Enter/Esc/Backspace).
- EPSG:2039 proj4: `+proj=tmerc +lat_0=31.7343936111111 +lon_0=35.2045169444444 +k=1.0000067 +x_0=219529.584 +y_0=626907.39 +ellps=GRS80 +towgs84=23.772,17.49,17.859,-0.3132,-1.85274,1.67299,-5.4262 +units=m +no_defs`. Bounds (WGS84): 34.17,29.45 → 35.69,33.28.
- govmap aerial tiles: `cdn.govmap.gov.il/<cache>/L{level}/R{row-hex}/C{col-hex}.jpg` on an ITM grid (community sources); open-data WMS has vector layers only (verified by downloading GetCapabilities). Licence unverified.

## Hono (hono.dev: agents, agents/cli, getting-started cloudflare-workers + nodejs, helpers/websocket, guides/best-practices; official skill `honojs/skills@hono` installed)
- Scaffold: `npm create hono@latest` → template `cloudflare-workers` (or `hono init -t cloudflare-workers` into an existing dir; never overwrites). Templates ship an `AGENTS.md` ("Run `npx hono --help` first, and use the CLI instead of a dev server") and `@hono/cli` as a dev dependency.
- **Hono CLI (`@hono/cli`)**: loads the app in-process, JSON output `{ok, data|error}`, exit 0/1. `hono routes [--verbose]`, `hono request <path> [-X -d -H --trace]`, `hono batch <jsonl>` (ordered requests with `expect.status`/partial `expect.body`, `save` + `{{var}}`, cookies persist → **API contract tests in CI**), `hono snapshot` (capture behaviour as batch JSONL), `hono diff [--base ref]` (compare against last commit in a temp worktree), `hono benchmark`, `hono ssg`. With a wrangler config it injects local Cloudflare bindings; `--runtime workerd` runs the real Worker entry. → Used in 0.1 (scaffold), 6.2 (contract tests), 3.8 (snapshot to validate OpenAPI coverage).
- Docs as Markdown with `Accept: text/markdown`; `/llms.txt`, `/llms-full.txt`.
- Workers: `new Hono<{ Bindings: CloudflareBindings }>()`, `wrangler types --env-interface CloudflareBindings`; module worker `export default { fetch: app.fetch, scheduled }`; Durable Object classes exported from the same module; `.dev.vars` for local secrets; `cloudflare/wrangler-action@v3` for CI deploy.
- WebSocket helper: `upgradeWebSocket` from `@hono/cloudflare-workers` (no `onOpen` on Workers; don't stack CORS middleware on the WS route). For our design the Worker forwards the upgrade to the Room DO instead. Node: `upgradeWebSocket` from `@hono/node-server` with `ws` `WebSocketServer({noServer:true})` passed as `serve({ websocket: { server } })`; **`@hono/node-ws` is deprecated**.
- Best practices: no controllers (keeps path-param inference); `app.route('/areas', areas)` per resource file; `createFactory().createHandlers()` when handlers must live apart; export `AppType = typeof app` for the `hc` RPC client (shared types to the frontend).
- Validation/OpenAPI: `hono-openapi` `validator('json', zodSchema)` + `describeRoute` + `openAPIRouteHandler` (OpenAPI 3.1).

## TanStack Router + Query
- Vite plugin `tanstackRouter({ target: 'react' })` + file routes under `src/routes`; `beforeLoad` + `redirect` for protected routes; router context carries auth.
- Query: `setQueryData` for WebSocket-driven updates, `invalidateQueries` to re-sync; optimistic mutations with `onMutate` snapshot and `onError` rollback. → Realtime events patch the areas-in-bounds query cache; saves are optimistic with rollback on 409.

## Better Auth
- Fastify integration: catch-all `/api/auth/*` route converts Node request to Fetch `Request` via `fromNodeHeaders`, forwards to `auth.handler`. Register `@fastify/cors` with `credentials: true` before mounting. `trustedOrigins` must list the frontend origin.
- `auth.api.getSession({ headers })` validates a session from cookie headers anywhere, including the WebSocket upgrade request. Cookie cache avoids a DB round-trip on the hot path.
- Drizzle adapter; schema generated by `@better-auth/cli`. Env: `BETTER_AUTH_SECRET` (≥32 chars), `BETTER_AUTH_URL`. Local skill: `better-auth-best-practices`.

## Drizzle ORM + Neon
- `geometry()` column helper supports `type`, `mode`, `srid`; GiST via `index().using('gist', col)`. For Polygon, use `geometry('geom', { type: 'Polygon', srid: 4326 })` plus raw `sql` for `ST_AsGeoJSON` / `ST_GeomFromGeoJSON`. Drizzle does not create the extension; migration 0 runs `CREATE EXTENSION IF NOT EXISTS postgis`.
- `drizzle-kit generate` + `drizzle-kit migrate`. Neon: run migrations over the **direct** connection string; app traffic over the `-pooler` string (PgBouncer transaction mode). `pg.Pool` works with Neon for a long-running Node server.
- Neon CLI: `neon branches create` per preview environment; Vercel integration can create a branch per preview deployment.

## Fastify ecosystem (superseded by Hono after the Cloudflare decision; kept for the record)
- `@fastify/websocket`: route option `{ websocket: true }`, `preValidation` hook rejects upgrade with 401, `fastify.websocketServer.clients` for broadcast, `preClose` for graceful shutdown, `maxPayload`.
- `@fastify/rate-limit`: `keyGenerator` returning user id, `max`/`timeWindow` per route via `config.rateLimit`, `groupId` for the drawing-action group, Redis store for multi-instance.
- `@fastify/swagger` dynamic mode builds OpenAPI 3 from route schemas; `@fastify/swagger-ui` serves it. Zod schemas via `fastify-type-provider-zod`.
- Core: `handlerTimeout` per server/route with `request.signal`; `setErrorHandler` sanitizes 5xx; pino logger with request ids and `redact`.

## Cloudflare (deployment + realtime) — replaces the earlier Vercel option
- Workers are fetch-handler runtimes (workerd), not Node servers, so Fastify does not apply. Hono runs on Workers and on Node (`@hono/node-server`), so one app serves `wrangler dev`, docker-compose, and production.
- Durable Objects (DO) with the WebSocket Hibernation API: `ctx.acceptWebSocket(server)`, class handlers `webSocketMessage/Close/Error`, `ctx.getWebSockets()` for broadcast, `serializeAttachment` (≤16 KB) for per-socket state that survives hibernation, `setWebSocketAutoResponse` for ping/pong without waking. One DO per room is the single coordinator, which removes the multi-instance fan-out problem. Soft limit ≈1,000 req/s per object; CPU 30 s per event; SQLite-backed storage on Free and Paid. Alarms (`setAlarm`, at-least-once, 6 retries) suit presence timeouts and cleanup.
- Hyperdrive: pooled Postgres from Workers via `env.HYPERDRIVE.connectionString`; create a `pg` client per request; transaction-pooling mode (no session state; `postgres.js` with `prepare:false` unreliable; cap `max` at 5). Needs `nodejs_compat` (default for compat dates ≥ 2026-08-04). Drizzle on node-postgres is supported. Migrations run against the Neon direct URL from CI, not through Hyperdrive.
- Static assets: Vite SPA served by the same Worker via `assets.directory`, `not_found_handling = "single-page-application"`, `run_worker_first = ["/api/*", "/ws"]`; `@cloudflare/vite-plugin` runs the Worker inside Vite dev with HMR and supports `vite preview` on workerd.
- Rate limiting binding: `limit({ key })`, period 10 or 60 s, per-location and eventually consistent ("permissive"). → Not exact enough for the brief's 50/min/user; use a per-user DO counter (exact, shared by REST and WS); the binding can act as a cheap edge pre-filter.
- Cache API (`caches.default`, honours `s-maxage`) and KV for cached bounds responses; Cron Triggers (`scheduled` handler alongside Hono `fetch`) for the retention purge; Workers Logs via `observability.enabled`.
- Better Auth on Workers: needs `nodejs_compat` (or `nodejs_als`) for AsyncLocalStorage; mount `app.all('/api/auth/*', c => auth.handler(c.req.raw))` after `cors` with explicit origin + credentials.
- Leaflet choice recorded above (1.9.4).
- Earlier Vercel findings (kept for the ADR): WebSockets in public beta, connection pinned to one instance with a 300 s/800 s duration cap, Redis pub/sub needed for fan-out. The duration cap is the reason for the switch.

## Blocked lookups (noted for the reviewer)
- 1Password item for Neon: service account requires `--vault`; the permission classifier also blocked the lookup. Waiting on the user.
- One Context7 PostGIS query was blocked by the permission classifier; replaced by direct reads of postgis.net.
