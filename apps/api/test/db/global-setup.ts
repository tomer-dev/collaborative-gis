import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import type { TestProject } from 'vitest/node';
import { migrate } from '../../src/db/migrate';
import { LANE_ENV, laneDatabase } from '../lane';

declare module 'vitest' {
  export interface ProvidedContext {
    /** URL of the db lane's test database, migrated from scratch for this run. */
    databaseUrl: string;
    /**
     * A second database, migrated the same way, for seed.test.ts alone: the seed tops up by
     * counting `SEED.NAME_PREFIX` rows, so it needs a table no other file seeds into.
     */
    seedDatabaseUrl: string;
  }
}

const dbLane = fileURLToPath(new URL('../../../../scripts/db-lane.sh', import.meta.url));

/**
 * Creates the db lane's two databases (`cgis_db_<lane>` and `cgis_db_seed_<lane>`: test/lane.ts;
 * apps/api/vitest.config.ts sets the lane) on the local compose PostGIS (scripts/db-lane.sh),
 * empties them, and runs every migration once on each, so the migrations are proven from scratch
 * on each run. Dropping `public` also drops PostGIS, which 0000_postgis.sql must then reinstall.
 */
export default async function setup(project: TestProject) {
  const lane = process.env[LANE_ENV] ?? '';
  const [url, seedUrl] = await Promise.all([
    freshDatabase(laneDatabase('cgis_db', lane)),
    freshDatabase(laneDatabase('cgis_db_seed', lane)),
  ]);
  project.provide('databaseUrl', url);
  project.provide('seedDatabaseUrl', seedUrl);
}

export async function freshDatabase(name: string): Promise<string> {
  const url = execFileSync('bash', [dbLane, name], { encoding: 'utf8' }).trim();

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('drop schema if exists drizzle cascade');
    await client.query('drop schema public cascade');
    await client.query('create schema public');
    const { rows } = await client.query("select 1 from pg_extension where extname = 'postgis'");
    if (rows.length > 0) {
      throw new Error('reset left PostGIS installed; the 0000 test would prove nothing');
    }
  } finally {
    await client.end();
  }

  await migrate(url);
  return url;
}
