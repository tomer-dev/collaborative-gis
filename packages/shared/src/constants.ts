// Single source of truth for tunable values; docs/constants.md mirrors it. Add new values to both.

/** Input and query limits (spec §5, D13). */
export const LIMITS = {
  POLYGON_MAX_VERTICES: 1000,
  AREA_NAME_MAX: 120,
  BOUNDS_LIMIT: 500,
  SIMPLIFY_ZOOM_BELOW: 12,
  SIMPLIFY_TOLERANCE: 0.0005,
  /** Better Auth's default `minPasswordLength`; the register form's `minlength`. */
  PASSWORD_MIN: 8,
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

// Better Auth mount; the endpoint paths below are built on it.
const AUTH = '/api/auth';

/** HTTP paths the Worker serves and the SPA calls. */
export const ROUTES = {
  API_PREFIX: '/api',
  HEALTHZ: '/healthz',
  READYZ: '/readyz',
  AUTH,
  AUTH_SIGN_UP: `${AUTH}/sign-up/email`,
  AUTH_SIGN_IN: `${AUTH}/sign-in/email`,
  AUTH_SIGN_OUT: `${AUTH}/sign-out`,
  AUTH_GET_SESSION: `${AUTH}/get-session`,
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
} as const;

/** TanStack Query options the SPA sets per query. */
export const QUERY = {
  /** GET get-session retries: a failed check counts as signed out, so the guard redirects at once. */
  SESSION_RETRY: 0,
} as const;

/** User-facing text in the SPA, grouped by screen. */
export const COPY = {
  APP: {
    NAME: 'Collaborative GIS',
  },
  AUTH: {
    LOGIN_TITLE: 'Sign in',
    LOGIN_SUBMIT: 'Sign in',
    LOGIN_PENDING: 'Signing in…',
    LOGIN_ERROR_TITLE: 'Could not sign in',
    LOGIN_SWITCH_PROMPT: 'No account yet?',
    LOGIN_SWITCH_LINK: 'Create one',
    REGISTER_TITLE: 'Create an account',
    REGISTER_SUBMIT: 'Create account',
    REGISTER_PENDING: 'Creating account…',
    REGISTER_ERROR_TITLE: 'Could not create the account',
    REGISTER_SWITCH_PROMPT: 'Already have an account?',
    REGISTER_SWITCH_LINK: 'Sign in',
    NAME_LABEL: 'Name',
    EMAIL_LABEL: 'Email',
    PASSWORD_LABEL: 'Password',
    PASSWORD_HINT: `At least ${LIMITS.PASSWORD_MIN} characters.`,
    /** Shown when a failed auth call carries no server message (network error, non-JSON body). */
    ERROR_GENERIC: 'Something went wrong. Try again.',
    SIGN_OUT: 'Sign out',
    SIGN_OUT_ERROR: 'Could not sign out. Try again.',
  },
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
