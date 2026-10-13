import type { TestProject } from 'vitest/node';
import { freshDatabase } from './db/global-setup';
import { LANE_ENV, laneDatabase } from './lane';

declare module 'vitest' {
  export interface ProvidedContext {
    /** The URL of each workers lane database by base name (`laneEnv(base)`), fresh for this run. */
    laneUrls: Record<string, string>;
  }
}

/** The lane databases the workers tests ask `laneEnv` for. */
const BASES = ['cgis_api', 'cgis_audit', 'cgis_auth', 'cgis_health', 'cgis_retention'];

/**
 * The workers project's globalSetup: creates each base's lane database on the local compose PostGIS,
 * empties it and migrates it (db/global-setup.ts's `freshDatabase`), in Node, before any test runs.
 */
export default async function setup(project: TestProject) {
  const lane = process.env[LANE_ENV] ?? '';
  const urls = await Promise.all(BASES.map((base) => freshDatabase(laneDatabase(base, lane))));
  project.provide('laneUrls', Object.fromEntries(BASES.map((base, i) => [base, urls[i] ?? ''])));
}
