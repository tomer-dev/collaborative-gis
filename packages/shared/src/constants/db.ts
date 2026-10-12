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
 * `(entity_id, version)`, pointing at the `area_versions` row the action produced.
 */
export const AUDIT = {
  ENTITIES: { AREA: 'area' },
  ACTIONS: {
    AREA_CREATE: 'area.create',
    AREA_UPDATE: 'area.update',
    AREA_DELETE: 'area.delete',
    /** `POST /api/areas/:id/revert/:version`; the row's `version` is the new version it wrote. */
    AREA_REVERT: 'area.revert',
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
