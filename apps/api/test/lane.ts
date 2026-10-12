/**
 * Test lanes: every local test database is named `<base>_<lane>`, where the lane is
 * `CGIS_TEST_LANE` or, unset, the current git branch (apps/api/vitest.config.ts resolves it), so
 * parallel worktrees on one compose PostGIS never reset each other's databases.
 *
 * Pure (no Node or workerd imports): lane-db.ts (workerd) and db/global-setup.ts (Node) share it.
 */

declare module 'vitest' {
  export interface ProvidedContext {
    /** The test lane, sanitised for a Postgres identifier ('' = none). */
    testLane: string;
  }
}

/** Environment variable that names the test lane; unset, the git branch names it. */
export const LANE_ENV = 'CGIS_TEST_LANE';

/** Postgres truncates identifiers longer than this many bytes (NAMEDATALEN - 1). */
const PG_IDENTIFIER_MAX = 63;

/** `lane` as an identifier part: lowercase letters, digits and single underscores. */
export function sanitizeLane(lane: string): string {
  return lane
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** The database `base` gets in `lane`: `<base>_<lane>`, at most 63 characters. */
export function laneDatabase(base: string, lane: string): string {
  const suffix = sanitizeLane(lane);
  return (suffix ? `${base}_${suffix}` : base).slice(0, PG_IDENTIFIER_MAX);
}
