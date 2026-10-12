import { ERROR_CODES } from './errors.ts';
import { ROUTES } from './routes.ts';

/**
 * Random seed polygons (apps/api/src/db/seed.ts, `pnpm --filter @cgis/api db:seed [--count N]`):
 * the tests' small set, and the 10k benchmark set with `--count 10000`.
 */
export const SEED = {
  /** Default row count: enough for the planner to have statistics, fast to insert. */
  COUNT: 50,
  /** Rows per insert statement; each row binds 4 parameters (Postgres allows 65,535). */
  BATCH: 500,
  /** Every seeded name starts with it; a rerun counts those rows and only tops up to the count. */
  NAME_PREFIX: 'seed-',
  /** Israel as [w, s, e, n] in degrees: the demo region (MAP.DEFAULT_CENTER sits inside it). */
  BBOX: [34.27, 29.49, 35.9, 33.34],
  /** Smallest polygon scale (centre to farthest vertex), in degrees: every polygon ≥ 0.2 km across. */
  MIN_RADIUS_DEG: 0.003,
  /** Largest distance from a polygon's centre to a vertex, in degrees: ≤ 3 km across. */
  MAX_RADIUS_DEG: 0.013,
  /** Small, varied rings. */
  VERTICES: { min: 4, max: 12 },
  /** Seeded rows are recognisable by `created_by`. */
  USER_ID: 'seed',
} as const;

/**
 * The bounds-query benchmark (`pnpm --filter @cgis/api db:explain`): EXPLAIN ANALYZE with and
 * without the GiST index, written to docs/benchmarks.md.
 */
export const BENCH = {
  /** Table size the benchmark seeds up to before measuring. */
  ROWS: 10_000,
  /** Runs per plan; p50 and p95 are taken over these. */
  RUNS: 20,
  /** A ~15 x 11 km viewport over Tel Aviv as [w, s, e, n] in degrees. */
  VIEWPORT: [34.72, 32.02, 34.88, 32.12],
  /** p95 budget for the bounds query's execution time: recorded next to the result, not asserted. */
  BOUNDS_P95_MS: 100,
} as const;

/**
 * `audit_log` vocabulary (D20): one row per user action. An area event's row carries
 * `(entity_id, version)`, pointing at the `area_versions` row the action produced. Area mutations
 * (and a create's draw session) write their rows inside the mutation's transaction; auth events
 * and rejected requests come from the audit middleware after the response.
 */
export const AUDIT = {
  /** `audit_log.entity`: what the row's `entity_id` names (NULL when the event has no such id). */
  ENTITIES: {
    /** An area; `entity_id` is its id. */
    AREA: 'area',
    /** An account; `entity_id` is the user id (NULL for a failed sign-in). */
    USER: 'user',
    /** A rejected HTTP request; no entity id (the row's `request_id` names the request). */
    REQUEST: 'request',
    /** A draft drawn on the map; no entity id (its request's `area.create` row names the area). */
    DRAFT: 'draft',
  },
  /** `audit_log.action`: every event the API records, one group. */
  ACTIONS: {
    /** A new area; `(entity_id, version)` points at its version 1 row in `area_versions`. */
    AREA_CREATE: 'area.create',
    /** An area edit; the row's `version` is the version the edit produced. */
    AREA_UPDATE: 'area.update',
    /** A soft delete; the row's `version` is the bumped version the delete recorded. */
    AREA_DELETE: 'area.delete',
    /** `POST /api/areas/:id/revert/:version`; the row's `version` is the new version it wrote. */
    AREA_REVERT: 'area.revert',
    /** Better Auth accepted an email sign-in (2xx); the row's user is the one signed in. */
    AUTH_SIGN_IN: 'auth.sign_in',
    /** An email sign-up created an account (2xx). */
    AUTH_SIGN_UP: 'auth.sign_up',
    /** A sign-out answered 2xx; the row's user is the one whose session ended. */
    AUTH_SIGN_OUT: 'auth.sign_out',
    /**
     * An email sign-in answered anything but 2xx (wrong password, unknown email, bad body, rate
     * limit); no user, and `details` keeps the status and Better Auth's error code.
     */
    AUTH_SIGN_IN_FAILED: 'auth.sign_in_failed',
    /** A response with one of `CAPTURE.REJECTED_CODES` under `/api`; `details.code` says which. */
    REQUEST_REJECTED: 'request.rejected',
    /**
     * A draft saved as an area: one per create, in its transaction, `details.vertices` the ring's
     * vertex count. The Room writes none (its `clear` is also a resync or a cancel).
     */
    DRAW_SESSION: 'draw.session',
    /** One retention purge batch (`RETENTION`): no user, the deleted counts in `details`. */
    RETENTION_PURGE: 'retention.purge',
  },
  /** Which responses the audit middleware records (apps/api/src/middleware/audit.ts). */
  CAPTURE: {
    /** Better Auth's email sign-in: 2xx → `auth.sign_in`, any other status → `auth.sign_in_failed`. */
    SIGN_IN_PATH: `${ROUTES.AUTH}/sign-in/email`,
    /** Better Auth's email sign-up: 2xx → `auth.sign_up`. */
    SIGN_UP_PATH: `${ROUTES.AUTH}/sign-up/email`,
    /** Better Auth's sign-out: 2xx → `auth.sign_out`. */
    SIGN_OUT_PATH: `${ROUTES.AUTH}/sign-out`,
    /**
     * Responses recorded as `request.rejected` anywhere under `/api`: validation (422) and rate
     * limits (429). A failed sign-in is recorded once, as `auth.sign_in_failed`.
     */
    REJECTED_CODES: [ERROR_CODES.UNPROCESSABLE, ERROR_CODES.RATE_LIMITED],
  },
} as const;

/**
 * Retention of soft-deleted areas (D8): a daily Cron Trigger (apps/api/src/scheduled.ts)
 * hard-deletes areas deleted more than `DAYS` ago, with their `area_versions`.
 */
export const RETENTION = {
  /** Days a soft-deleted area and its version history are kept before the purge removes them. */
  DAYS: 7,
  /**
   * When the purge runs (cron syntax, UTC): daily at 03:00. apps/api/wrangler.jsonc
   * `triggers.crons` repeats it as a JSON literal; a test fails when the two differ.
   */
  CRON: '0 3 * * *',
  /**
   * Most areas one purge statement deletes (with their versions), each batch its own transaction
   * and audit row: a backlog shrinks run by run instead of one statement outgrowing the query
   * timeout (`TIMEOUTS.DB_QUERY_MS`) every night.
   */
  BATCH: 500,
} as const;
