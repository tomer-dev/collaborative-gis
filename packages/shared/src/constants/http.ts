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

/** The `GET /openapi.json` document's `info` (hono-openapi `openAPIRouteHandler`) and the `/docs` UI. */
export const OPENAPI = {
  /** Names the `/openapi.json` document and the `/docs` page. */
  TITLE: 'Collaborative GIS API',
  /** Document version; bump with breaking contract changes. */
  VERSION: '0.1.0',
  /**
   * The `/docs` page's Scalar script, pinned (jsDelivr versioned paths are immutable) instead of the
   * CDN's moving latest, since it runs on the API origin. Bump with `@scalar/hono-api-reference`.
   */
  UI_BUNDLE: 'https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.73.1/esm.js',
} as const;
