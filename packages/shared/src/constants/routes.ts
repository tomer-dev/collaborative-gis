/** HTTP paths the Worker serves and the SPA calls. */
export const ROUTES = {
  /** Everything under it goes to `wrangler dev`. */
  API_PREFIX: '/api',
  /** Liveness. */
  HEALTHZ: '/healthz',
  /** Readiness (DB reachable). */
  READYZ: '/readyz',
  /** Better Auth mount. */
  AUTH: '/api/auth',
  /** Area CRUD + bbox query. */
  AREAS: '/api/areas',
  /** One area, relative to AREAS (`PUT`/`DELETE /api/areas/:id`). */
  AREA_BY_ID: '/:id',
  /** Room WebSocket upgrade. */
  WS: '/ws',
  /** OpenAPI 3.1 document of the routes with `describeRoute` metadata. */
  OPENAPI: '/openapi.json',
  /** SPA routes: redirect/Link/navigate targets (file-route ids in createFileRoute stay literal). */
  APP: { HOME: '/', LOGIN: '/login', REGISTER: '/register', MAP: '/map' },
} as const;

/** Local dev origins: `wrangler dev` (API) and `vite` (SPA); wrangler.jsonc CLIENT_ORIGIN mirrors WEB_ORIGIN. */
export const DEV = {
  /** `wrangler dev` default port. */
  API_ORIGIN: 'http://localhost:8787',
  /** `vite` default port; CORS and Better Auth trusted origin. */
  WEB_ORIGIN: 'http://localhost:5173',
} as const;
