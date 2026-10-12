/** Standard request headers the API reads by name (lower case, as `Headers` stores them). */
export const HEADERS = {
  /**
   * Browsers always send Origin on a WebSocket upgrade; the gate compares it with
   * `env.CLIENT_ORIGIN`.
   */
  ORIGIN: 'origin',
  /** The client IP Cloudflare sets on every request; recorded on audit rows. */
  CF_CONNECTING_IP: 'cf-connecting-ip',
  /** D20 audit context. */
  USER_AGENT: 'user-agent',
} as const;

/** Structured logs: a value whose key contains one of REDACT_KEYS (any case, any depth) is replaced by REDACTED. */
export const LOG = {
  /**
   * Spec §6: secrets never reach Workers Logs (`set-cookie`, `BETTER_AUTH_SECRET`, `Authorization`
   * all match).
   */
  REDACT_KEYS: ['password', 'secret', 'cookie', 'authorization'],
  /** Replacement value; keeps the key so the log still shows the field was present. */
  REDACTED: '[redacted]',
} as const;

/** The `GET /openapi.json` document's `info` (hono-openapi `openAPIRouteHandler`). */
export const OPENAPI = {
  /** Names the `/openapi.json` document. */
  TITLE: 'Collaborative GIS API',
  /** Document version; bump with breaking contract changes. */
  VERSION: '0.1.0',
} as const;

/** `GET /readyz` body values; the 503 `NOT_READY` carries the same `{ db, room }` in `details`. */
export const READINESS = {
  /** 200 `status`: the database and the Room both answered. */
  READY: 'ready',
  /** A dependency answered within its deadline. */
  UP: 'up',
  /** A dependency failed or missed its deadline. */
  DOWN: 'down',
} as const;
