// Single source of truth for tunable values; docs/constants.md mirrors it. Add new values to both.

/** Input and query limits (spec §5, D13). */
export const LIMITS = {
  POLYGON_MAX_VERTICES: 1000,
  AREA_NAME_MAX: 120,
  BOUNDS_LIMIT: 500,
  SIMPLIFY_ZOOM_BELOW: 12,
  SIMPLIFY_TOLERANCE: 0.0005,
} as const;

/** Realtime room behaviour, server and client (D13). */
export const WS = {
  DRAFT_RATE_PER_SEC: 10,
  PRESENCE_IDLE_MS: 60_000,
  ALARM_INTERVAL_MS: 30_000,
  BAD_FRAME_STRIKES: 10,
  CLOSE_POLICY_VIOLATION: 1008,
  PING_INTERVAL_MS: 30_000,
  RECONNECT_BACKOFF_MS: { min: 1000, max: 30_000 },
  OFFLINE_POLL_MS: 10_000,
} as const;

/** Time budgets for the database and for a whole request. */
export const TIMEOUTS = {
  DB_CONNECT_MS: 3000,
  DB_QUERY_MS: 3000,
  REQUEST_MS: 10_000,
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
} as const;

/** Local dev origins: `wrangler dev` (API) and `vite` (SPA); wrangler.jsonc CLIENT_ORIGIN mirrors WEB_ORIGIN. */
export const DEV = {
  API_ORIGIN: 'http://localhost:8787',
  WEB_ORIGIN: 'http://localhost:5173',
} as const;

/** The single shared map (D11). */
export const ROOM = {
  DEFAULT_ROOM_ID: 'default',
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
  /** Categorical presence hues by join order (design brief §3); apps/web/src/styles/tokens.css mirrors them as --color-presence-1..8. */
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
  HANDLE_RADIUS_PX: 6,
  HANDLE_HIT_PX: 24,
  HANDLE_BORDER_PX: 2,
  /** Leaflet path options for a sketch in progress (own draft now, remote ghosts in T14); design brief §4: 2 px, dashed 8/4, fill 12 %. */
  DRAFT_STYLE: { weight: 2, dashArray: '8 4', fillOpacity: 0.12 },
} as const;

/** Geodesy constants for client-side measurements. */
export const GEO = {
  EARTH_RADIUS_M: 6371008.8,
} as const;

/** Polygon draw tool: the map container's accessible name and the client-side `draw:invalid` reasons. */
export const DRAW = {
  ARIA_LABEL:
    'Polygon drawing. Click to add a vertex, drag a vertex to move it, Enter or double-click to finish, Backspace to undo, Escape to cancel.',
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
