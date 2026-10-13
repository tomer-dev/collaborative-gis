import { GEO, SEED } from '@cgis/shared';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { seedAreas } from '../../src/db/seed';

// Runs on its own database (seedDatabaseUrl, see global-setup.ts): the seed tops up by counting the
// seed user's rows, so a file seeding into cgis_db alongside would change what is counted.
// The tests run in order and build on each other's rows.
const client = new pg.Client({ connectionString: inject('seedDatabaseUrl') });
beforeAll(() => client.connect());
afterAll(() => client.end());

const ROWS = 1000;
const BUDGET_MS = 10_000;
const KM = 1000;
const seedName = `${SEED.NAME_PREFIX}%`;

async function one<T>(text: string, values: unknown[] = []): Promise<T> {
  const { rows } = await client.query(text, values);
  return rows[0];
}

describe('seedAreas', () => {
  it(
    `inserts ${ROWS} rows in under ${BUDGET_MS / 1000} s; a rerun with the same count adds nothing`,
    async () => {
      const started = performance.now();
      const first = await seedAreas(client, { count: ROWS });
      const elapsedMs = performance.now() - started;

      expect(first.existing).toBe(0);
      expect(new Set(first.inserted).size).toBe(ROWS);
      expect(elapsedMs).toBeLessThan(BUDGET_MS);

      expect(await seedAreas(client, { count: ROWS })).toEqual({ existing: ROWS, inserted: [] });
      expect(await one('select count(*)::int as n from areas', [])).toEqual({ n: ROWS });
    },
    3 * BUDGET_MS,
  );

  it('stores valid polygons inside the bbox, at version 1, by the seed user, with their area', async () => {
    const [w, s, e, n] = SEED.BBOX;
    const stats = await one(
      `select count(*)::int as n,
         bool_and(ST_IsValid(geom)) as valid,
         bool_and(ST_Within(geom, ST_MakeEnvelope($2, $3, $4, $5, $6))) as inside,
         min(ST_NPoints(geom) - 1) as min_vertices,
         max(ST_NPoints(geom) - 1) as max_vertices,
         bool_and(version = 1 and created_by = $7 and deleted_at is null) as fresh,
         bool_and(abs(area_km2 - ST_Area(geom::geography) / 1e6) < 1e-6) as geodesic_area
       from areas where name like $1`,
      [seedName, w, s, e, n, GEO.SRID, SEED.USER_ID],
    );
    expect(stats).toEqual({
      n: ROWS,
      valid: true,
      inside: true,
      min_vertices: SEED.VERTICES.min,
      max_vertices: SEED.VERTICES.max,
      fresh: true,
      geodesic_area: true,
    });

    const { rows } = await client.query<{ name: string }>('select name from areas');
    const expected = Array.from({ length: ROWS }, (_, i) => `${SEED.NAME_PREFIX}${i + 1}`);
    expect(rows.map((r) => r.name).sort()).toEqual(expected.sort());
  });

  it('makes every polygon 0.2–3 km across (largest geodesic distance between two vertices)', async () => {
    const across = await one<{ min: number; max: number }>(
      `select min(d) as min, max(d) as max from (
         select max(ST_Distance(p.geom::geography, q.geom::geography)) as d
         from areas a, ST_DumpPoints(a.geom) p, ST_DumpPoints(a.geom) q
         where a.name like $1 group by a.id) widths`,
      [seedName],
    );
    expect(across.min).toBeGreaterThanOrEqual(0.2 * KM);
    expect(across.max).toBeLessThanOrEqual(3 * KM);
  });

  it('records each seeded area as its version 1 row', async () => {
    const matching = await one(
      `select count(*)::int as n from areas a join area_versions v on v.area_id = a.id
       where a.name like $1 and v.version = 1 and v.name = a.name and v.changed_by = a.created_by
         and v.area_km2 = a.area_km2 and ST_Equals(v.geom, a.geom)`,
      [seedName],
    );
    expect(matching).toEqual({ n: ROWS });
    expect(await one('select count(*)::int as n from area_versions')).toEqual({ n: ROWS });
  });

  it('tops up to a larger count in batches of `batch`, continuing the names', async () => {
    const result = await seedAreas(client, { count: ROWS + 5, batch: 2 });

    expect(result.existing).toBe(ROWS);
    expect(result.inserted).toHaveLength(5);
    const { rows } = await client.query<{ name: string }>(
      'select name from areas where id = any($1::uuid[]) order by name',
      [result.inserted],
    );
    expect(rows.map((r) => r.name)).toEqual(
      [1, 2, 3, 4, 5].map((k) => `${SEED.NAME_PREFIX}${ROWS + k}`).sort(),
    );
  });

  it('counts only the seed user’s areas: a user’s own "seed-…" area does not shift the top-up', async () => {
    await client.query(
      `insert into areas (name, geom, area_km2, created_by)
       values ($1, ST_GeomFromText('POLYGON((0 0,1 0,1 1,0 1,0 0))', 4326), 1, 'someone')`,
      [`${SEED.NAME_PREFIX}garden`],
    );

    const result = await seedAreas(client, { count: ROWS + 6 });

    expect(result.existing).toBe(ROWS + 5);
    expect(result.inserted).toHaveLength(1);
  });
});
