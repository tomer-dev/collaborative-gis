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
   * The `/docs` page's Scalar script: the single-file browser build of a pinned release (no
   * code-split chunks, so one integrity hash covers all of it), never the CDN's moving latest,
   * since it runs on the API origin. Bump the version here and `UI_BUNDLE_INTEGRITY` with it.
   */
  UI_BUNDLE: 'https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.73.1/dist/browser/standalone.js',
  /**
   * Subresource Integrity of `UI_BUNDLE`: the browser refuses the script if the CDN serves other
   * bytes. `curl -sS -o f <UI_BUNDLE> && openssl dgst -sha384 -binary f | openssl base64 -A`
   * (matches `dist/browser/standalone.js` in the npm tarball).
   */
  UI_BUNDLE_INTEGRITY: 'sha384-kYDGzV91Jnn3TbHINV3nt54riK2uMJDfN5Al8dAkz4FssELTBWbD8rgw32sTKfOi',
} as const;

/** `GET /readyz` body values; the 503 `NOT_READY` repeats `{ db, room, config }` in `details`. */
export const READINESS = {
  /** 200 `status`: the database and the Room answered, and both origin vars are absolute URLs. */
  READY: 'ready',
  /** A dependency answered within its deadline, or (`config`) both origin vars are URLs. */
  UP: 'up',
  /** A dependency failed or missed its deadline, or (`config`) an origin var is not a URL. */
  DOWN: 'down',
} as const;
