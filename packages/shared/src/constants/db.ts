import { ERROR_CODES } from './errors.ts';
import { ROUTES } from './routes.ts';

/** The small test seed (apps/api/src/db/seed.ts); the 10k benchmark seed is M2. */
export const SEED = {
  /** Enough rows for the planner to have statistics, fast to insert. */
  COUNT: 50,
  /** Israel as [w, s, e, n] in degrees: the demo region (MAP.DEFAULT_CENTER sits inside it). */
  BBOX: [34.27, 29.49, 35.9, 33.34],
  /** Largest distance from a polygon's centre to a vertex, in degrees (~2 km). */
  MAX_RADIUS_DEG: 0.02,
  /** Small, varied rings. */
  VERTICES: { min: 4, max: 8 },
  /** Seeded rows are recognisable. */
  USER_ID: 'seed',
} as const;

/**
 * `audit_log` vocabulary (D20): one row per user action. An area event's row carries
 * `(entity_id, version)`, pointing at the `area_versions` row the action produced. Area mutations
 * write their row inside the mutation's transaction; auth events and rejected requests come from
 * the audit middleware after the response, draw sessions from the Room.
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
    /** A Room draft; no entity id (a draft is the user's, and gone once the session ends). */
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
    /** A completed Room draft: a `clear` that ended a draft of ≥ 1 vertex (`details.vertices`). */
    DRAW_SESSION: 'draw.session',
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
  /** `audit_log.action` of the one row each purge run writes: no user, the counts in `details`. */
  AUDIT_ACTION: 'retention.purge',
} as const;
