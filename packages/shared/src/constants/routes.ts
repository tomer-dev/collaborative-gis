/** HTTP paths the Worker serves and the SPA calls. */
export const ROUTES = {
  /** Everything under it goes to `wrangler dev`. */
  API_PREFIX: '/api',
  /** Liveness. */
  HEALTHZ: '/healthz',
  /** Readiness: the database and the Room answer. */
  READYZ: '/readyz',
  /** Better Auth mount. */
  AUTH: '/api/auth',
  /** Area CRUD + bbox query. */
  AREAS: '/api/areas',
  /** One area, relative to AREAS (`PUT`/`DELETE /api/areas/:id`). */
  AREA_BY_ID: '/:id',
  /** One area's saved versions, relative to AREAS (`GET /api/areas/:id/versions`). */
  AREA_VERSIONS: '/:id/versions',
  /** Revert to a saved version, relative to AREAS (`POST /api/areas/:id/revert/:version`). */
  AREA_REVERT: '/:id/revert/:version',
  /** Room WebSocket upgrade. */
  WS: '/ws',
  /** OpenAPI 3.1 document of the routes with `describeRoute` metadata. */
  OPENAPI: '/openapi.json',
  /** API reference UI (Scalar) rendering OPENAPI; public and read-only, like the document. */
  DOCS: '/docs',
  /** SPA routes: redirect/Link/navigate targets (file-route ids in createFileRoute stay literal). */
  APP: { HOME: '/', LOGIN: '/login', REGISTER: '/register', MAP: '/map' },
} as const;

/** SPA router: how the app frame covers a route whose chunk (autoCodeSplitting) is still loading. */
export const ROUTER = {
  /** Delay before the empty app frame shows for a pending route; 0 = at once, never a blank. */
  PENDING_MS: 0,
  /** Shortest time the empty frame stays once shown; 0 = it leaves the moment the route is ready. */
  PENDING_MIN_MS: 0,
} as const;

/** Local dev origins. */
export const DEV = {
  /** `wrangler dev` default port: the Vite proxy target and the tests' `BETTER_AUTH_URL`. */
  API_ORIGIN: 'http://localhost:8787',
  /** `vite` default port: the e2e run's SPA origin (apps/web/e2e/stack.ts) and its Worker's CLIENT_ORIGIN. */
  WEB_ORIGIN: 'http://localhost:5173',
} as const;
