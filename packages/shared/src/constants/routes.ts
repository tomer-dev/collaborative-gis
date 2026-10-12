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
  /** SPA routes: redirect/Link/navigate targets (file-route ids in createFileRoute stay literal). */
  APP: { HOME: '/', LOGIN: '/login', REGISTER: '/register', MAP: '/map' },
} as const;

/** Local dev origins. */
export const DEV = {
  /** `wrangler dev` default port: the Vite proxy target and the tests' `BETTER_AUTH_URL`. */
  API_ORIGIN: 'http://localhost:8787',
} as const;
