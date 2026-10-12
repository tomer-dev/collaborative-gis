// Single source of truth for tunable values; docs/constants.md mirrors it. Add new values to both.

/** Input and query limits (spec §5, D13). */
export const LIMITS = {
  POLYGON_MAX_VERTICES: 1000,
  AREA_NAME_MAX: 120,
  USER_NAME_MAX: 60,
  USER_ID_MAX: 128,
  BOUNDS_LIMIT: 500,
  SIMPLIFY_ZOOM_BELOW: 12,
  SIMPLIFY_TOLERANCE: 0.0005,
} as const;

/** Spatial reference of every stored geometry, and the sphere for client-side measurements. */
export const GEO = {
  /** WGS 84 lng/lat: the `geometry(Polygon,4326)` columns, bbox envelopes, and GeoJSON's default. */
  SRID: 4326,
  /** WGS 84 mean radius R1 = (2a + b) / 3, in metres: the sphere `@turf/area` measures on. */
  EARTH_RADIUS_M: 6371008.8,
} as const;

/** The small test seed (apps/api/src/db/seed.ts); the 10k benchmark seed is M2. */
export const SEED = {
  COUNT: 50,
  /** Israel as [w, s, e, n] in degrees: the demo region (MAP.DEFAULT_CENTER sits inside it). */
  BBOX: [34.27, 29.49, 35.9, 33.34],
  /** Largest distance from a polygon's centre to a vertex, in degrees (~2 km). */
  MAX_RADIUS_DEG: 0.02,
  VERTICES: { min: 4, max: 8 },
  USER_ID: 'seed',
} as const;

/** Realtime room behaviour, server and client (D13). */
export const WS = {
  DRAFT_RATE_PER_SEC: 10,
  PRESENCE_IDLE_MS: 60_000,
  ALARM_INTERVAL_MS: 30_000,
  BAD_FRAME_STRIKES: 10,
  CLOSE_POLICY_VIOLATION: 1008,
  CLOSE_INTERNAL_ERROR: 1011,
  CLOSE_IDLE: 1001,
  PING_INTERVAL_MS: 30_000,
  AUTO_PING: 'ping',
  AUTO_PONG: 'pong',
  RECONNECT_BACKOFF_MS: { min: 1000, max: 30_000 },
  OFFLINE_POLL_MS: 10_000,
} as const;

/** Per-user budget shared by REST mutations and WS drawing actions (D5): an exact sliding window. */
export const RATE_LIMIT = {
  DRAW_ACTIONS_PER_WINDOW: 50,
  WINDOW_MS: 60_000,
  /** The only labels `RateLimiter.take` accepts; every action spends the same budget. */
  ACTIONS: { DRAW: 'draw', MUTATE: 'mutate' },
} as const;

export type RateLimitAction = (typeof RATE_LIMIT.ACTIONS)[keyof typeof RATE_LIMIT.ACTIONS];

/** Time budgets for the database and for a whole request. */
export const TIMEOUTS = {
  DB_CONNECT_MS: 3000,
  DB_QUERY_MS: 3000,
  REQUEST_MS: 10_000,
} as const;

/** Structured logs: a value whose key contains one of REDACT_KEYS (any case, any depth) is replaced by REDACTED. */
export const LOG = {
  REDACT_KEYS: ['password', 'secret', 'cookie', 'authorization'],
  REDACTED: '[redacted]',
} as const;

/** HTTP paths the Worker serves and the SPA calls. */
export const ROUTES = {
  API_PREFIX: '/api',
  HEALTHZ: '/healthz',
  READYZ: '/readyz',
  AUTH: '/api/auth',
  AREAS: '/api/areas',
  WS: '/ws',
  OPENAPI: '/openapi.json',
  /** SPA routes: redirect/Link/navigate targets (file-route ids in createFileRoute stay literal). */
  APP: { HOME: '/', LOGIN: '/login', REGISTER: '/register', MAP: '/map' },
} as const;

/** Local dev origins: `wrangler dev` (API) and `vite` (SPA); wrangler.jsonc CLIENT_ORIGIN mirrors WEB_ORIGIN. */
export const DEV = {
  API_ORIGIN: 'http://localhost:8787',
  WEB_ORIGIN: 'http://localhost:5173',
} as const;

/** The single shared map (D11). */
export const ROOM = {
  DEFAULT_ROOM_ID: 'default',
  USER_ID_HEADER: 'x-user-id',
  USER_NAME_HEADER: 'x-user-name',
} as const;

/** Leaflet map defaults; DEFAULT_CENTER is Leaflet's [lat, lng] order. */
export const MAP = {
  DEFAULT_CENTER: [31.5, 34.9],
  DEFAULT_ZOOM: 8,
  OSM_TILE_URL: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  OSM_ATTRIBUTION:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  OSM_MAX_ZOOM: 19,
  AREAS_PANE: 'areas',
  AREAS_PANE_Z: 450,
  DRAFTS_PANE: 'drafts',
  DRAFTS_PANE_Z: 460,
  MOVEEND_DEBOUNCE_MS: 250,
  PRESENCE_COLORS: [
    '#2a78d6',
    '#eb6834',
    '#1baf7a',
    '#eda100',
    '#e87ba4',
    '#008300',
    '#6250d6',
    '#e34948',
  ],
  /** Vertex handle hit box (Leaflet icon size); the dot's radius, ring and colours are CSS (`.cgis-draw-handle`). */
  HANDLE_HIT_PX: 24,
  /** Leaflet path options for a sketch in progress (own draft now, remote ghosts in T14); design brief §4: 2 px, dashed 8/4, fill 12 %. */
  DRAFT_STYLE: { weight: 2, dashArray: '8 4', fillOpacity: 0.12 },
} as const;

/** Polygon draw tool: the client-side `draw:invalid` reasons. */
export const DRAW = {
  SELF_INTERSECTION_REASON: 'Polygon edges must not cross or touch each other',
  MAX_VERTICES_REASON: 'Vertex limit reached',
} as const;

/** Every `ApiError.code` the API sends; apps/api/src/errors.ts maps each to its HTTP status. */
export const ERROR_CODES = {
  BAD_REQUEST: 'BAD_REQUEST',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  UNPROCESSABLE: 'UNPROCESSABLE',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  RATE_LIMITED: 'RATE_LIMITED',
  TIMEOUT: 'TIMEOUT',
  NOT_READY: 'NOT_READY',
  INTERNAL: 'INTERNAL',
  NOT_IMPLEMENTED: 'NOT_IMPLEMENTED',
  UPGRADE_REQUIRED: 'UPGRADE_REQUIRED',
} as const;

/** Default `ApiError.message` per code (clients and tests match on them); same keys as ERROR_CODES. */
export const ERROR_MESSAGES = {
  BAD_REQUEST: 'Bad request',
  UNAUTHORIZED: 'sign in',
  FORBIDDEN: 'Forbidden',
  NOT_FOUND: 'Not found',
  CONFLICT: 'Conflict',
  UNPROCESSABLE: 'Unprocessable',
  PAYLOAD_TOO_LARGE: 'Payload too large',
  RATE_LIMITED: 'Too many requests',
  TIMEOUT: 'timeout',
  NOT_READY: 'database unreachable',
  INTERNAL: 'Internal Server Error',
  NOT_IMPLEMENTED: 'not implemented',
  UPGRADE_REQUIRED: 'websocket upgrade required',
} as const satisfies Record<keyof typeof ERROR_CODES, string>;

/** `error` frame messages the Room sends where ERROR_MESSAGES' per-code default says too little. */
export const WS_MESSAGES = {
  NOT_JSON: 'frames must be JSON text',
  NOT_JOINED: 'send join first',
  DRAFT_OP_MISFIT: 'draft op does not fit the current draft',
} as const;
