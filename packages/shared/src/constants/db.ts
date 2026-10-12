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
 * `(entity_id, version)`, pointing at the `area_versions` row the action produced.
 */
export const AUDIT = {
  ENTITIES: { AREA: 'area' },
  ACTIONS: { AREA_CREATE: 'area.create', AREA_UPDATE: 'area.update', AREA_DELETE: 'area.delete' },
} as const;
