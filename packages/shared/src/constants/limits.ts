/** Positions in a polygon ring, closing vertex included (spec §5). */
const POLYGON_MAX_VERTICES = 1000;

/** Input and query limits (spec §5, D13). */
export const LIMITS = {
  /** Spec §5 polygon rule; bounds payload and `ST_IsValid` cost. */
  POLYGON_MAX_VERTICES,
  /** Positions minus the closing vertex: the most vertices a user can place while drawing. */
  POLYGON_MAX_PLACED_VERTICES: POLYGON_MAX_VERTICES - 1,
  /** D13 name length cap. */
  AREA_NAME_MAX: 120,
  /** Presence list and ghost labels stay short; attachments stay small. */
  USER_NAME_MAX: 60,
  /** With both strings capped, a socket attachment cannot reach the runtime's 16 KiB limit. */
  USER_ID_MAX: 128,
  /** Caps one viewport response. */
  BOUNDS_LIMIT: 500,
  /**
   * Request body cap on mutations (64 KiB): 413 `PAYLOAD_TOO_LARGE` before JSON parsing. A ring at
   * POLYGON_MAX_VERTICES with full-precision coordinates and a maximal name is about 41 KB.
   */
  BODY_MAX_BYTES: 64 * 1024,
  /**
   * Largest `version` a PUT body may carry: Postgres `integer` max, the type of `areas.version` and
   * `area_versions.version`. A larger value would fail the query (22003) as a 500, not a 422.
   */
  VERSION_MAX: 2_147_483_647,
  /**
   * Most versions `GET /api/areas/:id/versions` returns: the newest ones. Bounds the payload of a
   * long-edited area (each version carries its geometry).
   */
  VERSIONS_PAGE: 200,
  /**
   * Leading characters of a user id that name the editor in an area's history (the versions
   * payload carries ids, not names).
   */
  USER_ID_PREFIX: 8,
  /** Better Auth's default `minPasswordLength`; the register form's `minlength`. */
  PASSWORD_MIN: 8,
} as const;

/** Time budgets for the database, the Room ping and a whole request. */
export const TIMEOUTS = {
  /** `/readyz` and every DB call fail fast when the DB is unreachable. */
  DB_CONNECT_MS: 3000,
  /** Bounds one query inside the request budget. */
  DB_QUERY_MS: 3000,
  /** Whole-request budget (§6). */
  REQUEST_MS: 10_000,
  /** `/readyz` Room ping: the default Room must answer `getVersion()` within this. */
  DO_PING_MS: 1000,
} as const;
