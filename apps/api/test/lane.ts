/**
 * Test lanes: every local test database is named `<base>_<lane>`, where the lane is
 * `CGIS_TEST_LANE` or, unset, the current git branch (apps/api/vitest.config.ts resolves it), so
 * parallel worktrees on one compose PostGIS never reset each other's databases. The globalSetups
 * (db/global-setup.ts, lane-setup.ts) name the databases with it.
 */

/** Environment variable that names the test lane; unset, the git branch names it. */
export const LANE_ENV = 'CGIS_TEST_LANE';

/** Postgres truncates identifiers longer than this many bytes (NAMEDATALEN - 1). */
const PG_IDENTIFIER_MAX = 63;

/**
 * The database `base` gets in `lane`: `<base>_<lane>`, the lane as lowercase letters, digits and
 * single underscores, at most 63 characters in all.
 */
export function laneDatabase(base: string, lane: string): string {
  const suffix = lane
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return (suffix ? `${base}_${suffix}` : base).slice(0, PG_IDENTIFIER_MAX);
}
