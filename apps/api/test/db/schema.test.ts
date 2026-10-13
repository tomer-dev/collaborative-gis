import { readFileSync } from 'node:fs';
import type { Polygon } from '@cgis/shared';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { migrate } from '../../src/db/migrate';
import * as schema from '../../src/db/schema';
import { areas } from '../../src/db/schema';

const url = inject('databaseUrl');
const client = new pg.Client({ connectionString: url });

beforeAll(() => client.connect());
afterAll(() => client.end());

async function query<T>(text: string, values: unknown[] = []): Promise<T[]> {
  return (await client.query(text, values)).rows as T[];
}

const appliedMigrations = () =>
  query<{ id: number; hash: string; created_at: string }>(
    'select id, hash, created_at from drizzle.__drizzle_migrations order by id',
  );

describe('migrations', () => {
  it('install PostGIS (0000_postgis.sql) into a database without it', async () => {
    const [row] = await query<{ version: string }>('select postgis_version() as version');
    expect(row?.version).toMatch(/^3\.\d+ /);
  });

  it('record every journal entry in drizzle.__drizzle_migrations', async () => {
    const journal = JSON.parse(
      readFileSync(new URL('../../drizzle/meta/_journal.json', import.meta.url), 'utf8'),
    ) as { entries: { tag: string }[] };
    expect(journal.entries[0]?.tag).toBe('0000_postgis');
    expect(await appliedMigrations()).toHaveLength(journal.entries.length);
  });

  it('are a no-op when run again', async () => {
    const before = await appliedMigrations();
    await migrate(url);
    expect(await appliedMigrations()).toEqual(before);
  });
});

describe('areas', () => {
  it('has a GiST index on geom over live rows only', async () => {
    const rows = await query<{ indexdef: string }>(
      "select indexdef from pg_indexes where schemaname = 'public' and indexname = 'areas_geom_gist'",
    );
    expect(rows.map((r) => r.indexdef)).toEqual([
      'CREATE INDEX areas_geom_gist ON public.areas USING gist (geom) WHERE (deleted_at IS NULL)',
    ]);
  });

  it('writes geom from GeoJSON through Drizzle, stored with SRID 4326', async () => {
    const orm = drizzle(client, { schema });
    const square: Polygon = {
      type: 'Polygon',
      coordinates: [
        [
          [34.78, 32.08],
          [34.79, 32.08],
          [34.79, 32.09],
          [34.78, 32.09],
          [34.78, 32.08],
        ],
      ],
    };
    const [inserted] = await orm
      .insert(areas)
      .values({ name: 'square', geom: square, areaKm2: 0.9, createdBy: 'user-1' })
      .returning({
        id: areas.id,
        name: areas.name,
        areaKm2: areas.areaKm2,
        version: areas.version,
      });
    try {
      expect(inserted).toMatchObject({ name: 'square', areaKm2: 0.9, version: 1 });
      // Raw geom reads throw by design (see geometry.ts); GeoJSON comes back via ST_AsGeoJSON.
      const [stored] = await orm
        .select({
          srid: sql<number>`ST_SRID(${areas.geom})`,
          geom: sql<Polygon>`ST_AsGeoJSON(${areas.geom})::json`,
        })
        .from(areas)
        .where(eq(areas.id, inserted!.id));
      expect(stored).toEqual({ srid: 4326, geom: square });
    } finally {
      await orm.delete(areas).where(eq(areas.id, inserted!.id));
    }
  });
});
