// Node-only, like migrate.ts; the Worker never imports this file.
// CLI: `DATABASE_URL=<direct URL> pnpm --filter @cgis/api db:seed [--count N]` (default
// SEED.COUNT; `--count 10000` makes the benchmark set). Never a Hyperdrive URL.
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { type Bbox, SEED, type Polygon } from '@cgis/shared';
import { inArray, like } from 'drizzle-orm';
import pg from 'pg';
import { z } from 'zod';
import { areaKm2Of, fromGeoJson } from './geometry.ts';
import { db } from './index.ts';
import { areas, areaVersions } from './schema.ts';

export type SeedResult = {
  /** Seeded rows (named `SEED.NAME_PREFIX…`) already in the table before this run. */
  existing: number;
  /** Ids of the areas this run inserted. */
  inserted: string[];
};

/**
 * Tops the seeded areas up to `count`: counts the rows named `SEED.NAME_PREFIX…` and inserts the
 * rest as random polygons inside `bbox`, named on from there (`seed-1`, `seed-2`, …), so a rerun
 * with the same count inserts nothing. Each batch of `batch` rows is one transaction of two
 * builder inserts: the areas (version 1, geodesic `area_km2`, created by `SEED.USER_ID`), then
 * their version 1 rows copied from them.
 *
 * Each polygon is star-shaped around its centre: vertices at strictly increasing angles (gaps under
 * π) and positive radii never cross, so every ring passes `ST_IsValid`.
 */
export async function seedAreas(
  c: pg.Client,
  {
    count = SEED.COUNT,
    bbox = SEED.BBOX,
    batch = SEED.BATCH,
  }: { count?: number; bbox?: Bbox; batch?: number } = {},
): Promise<SeedResult> {
  const database = db(c);
  const existing = await database.$count(areas, like(areas.name, `${SEED.NAME_PREFIX}%`));
  const inserted: string[] = [];

  for (let done = existing; done < count; done += batch) {
    const rows = Array.from({ length: Math.min(batch, count - done) }, (_, k) => {
      const geometry = randomPolygon(bbox);
      return {
        name: `${SEED.NAME_PREFIX}${done + k + 1}`,
        geom: geometry,
        areaKm2: areaKm2Of(fromGeoJson(geometry)),
        createdBy: SEED.USER_ID,
      };
    });
    const ids = await database.transaction(async (tx) => {
      const added = (await tx.insert(areas).values(rows).returning({ id: areas.id })).map(
        (row) => row.id,
      );
      await tx.insert(areaVersions).select((qb) =>
        qb
          .select({
            areaId: areas.id,
            version: areas.version,
            name: areas.name,
            geom: areas.geom,
            areaKm2: areas.areaKm2,
            changedBy: areas.createdBy,
            changedAt: areas.createdAt,
          })
          .from(areas)
          .where(inArray(areas.id, added)),
      );
      return added;
    });
    inserted.push(...ids);
  }
  return { existing, inserted };
}

function randomPolygon([west, south, east, north]: Bbox): Polygon {
  const between = (min: number, max: number) => min + Math.random() * (max - min);
  const inset = SEED.MAX_RADIUS_DEG;
  const [cx, cy] = [between(west + inset, east - inset), between(south + inset, north - inset)];
  const scale = between(SEED.MIN_RADIUS_DEG, SEED.MAX_RADIUS_DEG);
  const n = Math.floor(between(SEED.VERTICES.min, SEED.VERTICES.max + 1));
  const step = (2 * Math.PI) / n;

  const ring = Array.from({ length: n }, (_, k): [number, number] => {
    const angle = (k + Math.random() / 2) * step; // jitter < step/2 keeps angles increasing, gaps < π
    const radius = between(scale / 2, scale);
    return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)];
  });
  return { type: 'Polygon', coordinates: [[...ring, ...ring.slice(0, 1)]] };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set (use the direct database URL, not Hyperdrive)');
    process.exit(1);
  }
  const { values } = parseArgs({ options: { count: { type: 'string' } } });
  const count = z.coerce
    .number()
    .int()
    .nonnegative()
    .parse(values.count ?? SEED.COUNT);

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const started = performance.now();
    const { existing, inserted } = await seedAreas(client, { count });
    const ms = Math.round(performance.now() - started);
    console.log(`seeded ${inserted.length} areas in ${ms} ms (${existing} were already there)`);
  } finally {
    await client.end();
  }
}
