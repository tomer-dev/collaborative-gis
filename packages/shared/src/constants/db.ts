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
  ACTIONS: { AREA_CREATE: 'area.create', AREA_UPDATE: 'area.update', AREA_DELETE: 'area.delete' },
} as const;
