import { AreaSchema, LIMITS, SEED, type Area, type Bbox, type Polygon } from '@cgis/shared';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { db } from '../../src/db';
import { seedAreas } from '../../src/db/seed';
import {
  areasInBoundsSql,
  InvalidGeometryError,
  insertArea,
  selectAreasInBounds,
  softDeleteArea,
  updateAreaIfVersion,
  writeAudit,
} from '../../src/db/spatial';

// Runs in the `db` project on cgis_db, next to schema.test.ts and geometry.test.ts (files run in
// parallel). Rows that a test asserts on exactly sit outside Israel, where the other files and the
// seed put theirs.
const url = inject('databaseUrl');
const client = new pg.Client({ connectionString: url });
beforeAll(() => client.connect());
afterAll(() => client.end());

const userId = 'user-t2';

/** The rectangle [w, s, e, n] as a closed GeoJSON polygon (counter-clockwise). */
function box(w: number, s: number, e: number, n: number): Polygon {
  return {
    type: 'Polygon',
    coordinates: [
      [
        [w, s],
        [e, s],
        [e, n],
        [w, n],
        [w, s],
      ],
    ],
  };
}

/** Two triangles meeting at (34.85, 32.05): passes the Zod ring rules, fails ST_IsValid. */
const bowtie: Polygon = {
  type: 'Polygon',
  coordinates: [
    [
      [34.8, 32.0],
      [34.9, 32.1],
      [34.9, 32.0],
      [34.8, 32.1],
      [34.8, 32.0],
    ],
  ],
};

async function count(text: string, values: unknown[]): Promise<number> {
  const { rows } = await client.query<{ n: number }>(
    `select count(*)::int as n from ${text}`,
    values,
  );
  return rows[0]!.n;
}

/** The area from a successful update; fails the test otherwise. */
function updated(result: Awaited<ReturnType<typeof updateAreaIfVersion>>): Area {
  if (!result.ok) throw new Error(`expected the update to succeed, got ${JSON.stringify(result)}`);
  return result.area;
}

async function versionRows(areaId: string) {
  const { rows } = await client.query<{ version: number; name: string; changed_by: string }>(
    'select version, name, changed_by from area_versions where area_id = $1 order by version',
    [areaId],
  );
  return rows;
}

// --- Reference area on the WGS 84 ellipsoid -------------------------------------------------------

const WGS84 = { a: 6_378_137, f: 1 / 298.257223563 }; // EPSG:7030 semi-major axis (m), flattening
const E2 = WGS84.f * (2 - WGS84.f); // first eccentricity squared
const E = Math.sqrt(E2);
const RAD = Math.PI / 180;
const M2_PER_KM2 = 1e6;

/** Snyder (USGS PP 1395) eq. 3-12: q(φ), so that the zone from the equator to φ is a²·q/2 per radian. */
function q(phi: number): number {
  const s = Math.sin(phi);
  return (1 - E2) * (s / (1 - E2 * s * s) - Math.log((1 - E * s) / (1 + E * s)) / (2 * E));
}

/**
 * Exact area, in km², of the ellipsoidal quadrangle between meridians w..e and parallels s..n:
 * A = (a²/2) · Δλ · (q(φn) − q(φs)).
 */
function quadrangleKm2(w: number, s: number, e: number, n: number): number {
  return ((WGS84.a ** 2 / 2) * (e - w) * RAD * (q(n * RAD) - q(s * RAD))) / M2_PER_KM2;
}

/**
 * The only way PostGIS's polygon differs from that quadrangle: its north and south edges are
 * geodesics, not parallels, so each bulges poleward. On a sphere of radius a the geodesic between
 * two points at latitude φ, Δλ apart, peaks at tan φm = tan φ / cos(Δλ/2). Each lens between edge
 * and parallel fits in a chord × sagitta rectangle, so the two together bound |A_postgis − A|.
 */
function edgeBulgeBoundKm2(w: number, s: number, e: number, n: number): number {
  const dLambda = (e - w) * RAD;
  const lens = (latDeg: number) => {
    const phi = latDeg * RAD;
    const sagitta = WGS84.a * (Math.atan(Math.tan(phi) / Math.cos(dLambda / 2)) - phi);
    const chord = WGS84.a * Math.cos(phi) * dLambda;
    return chord * sagitta;
  };
  return (lens(s) + lens(n)) / M2_PER_KM2;
}

// --- Plan inspection -------------------------------------------------------------------------------

type PlanNode = { 'Node Type': string; 'Index Name'?: string; Plans?: PlanNode[] };

function planNodes(node: PlanNode): PlanNode[] {
  return [node, ...(node.Plans ?? []).flatMap(planNodes)];
}

async function explainBounds(bbox: Bbox): Promise<PlanNode[]> {
  const { rows } = await db(client).execute<{ 'QUERY PLAN': [{ Plan: PlanNode }] }>(
    sql`EXPLAIN (FORMAT JSON) ${areasInBoundsSql(bbox, { limit: LIMITS.BOUNDS_LIMIT })}`,
  );
  return planNodes(rows[0]!['QUERY PLAN'][0].Plan);
}

// --- Tests -----------------------------------------------------------------------------------------

describe('insertArea', () => {
  it('stores the polygon with version 1 and returns it as an Area', async () => {
    const geometry = box(20, 40, 20.01, 40.01);
    const area = await insertArea(client, { name: 'first', geometry, userId });

    expect(AreaSchema.parse(area)).toEqual(area);
    expect(area).toMatchObject({ name: 'first', geometry, version: 1, createdBy: userId });
    expect(area.areaKm2).toBeGreaterThan(0);
    expect(await versionRows(area.id)).toEqual([{ version: 1, name: 'first', changed_by: userId }]);
  });

  it('rejects a self-intersecting polygon with the ST_IsValidReason text and writes nothing', async () => {
    const name = 'bowtie-insert';
    const error = await insertArea(client, { name, geometry: bowtie, userId }).catch((e) => e);

    expect(error).toBeInstanceOf(InvalidGeometryError);
    expect((error as InvalidGeometryError).reason).toMatch(/self-intersection/i);
    expect(await count('areas where name = $1', [name])).toBe(0);
  });

  it('stores area_km2 as the geodesic area on the WGS 84 ellipsoid (0.1° square at 32°N)', async () => {
    const tolerance = 0.001; // 0.1 %
    const [w, s, e, n] = [34.8, 32, 34.9, 32.1];
    const reference = quadrangleKm2(w, s, e, n);

    // The tolerance has to cover the edge bulge, the one difference the reference does not model.
    expect(edgeBulgeBoundKm2(w, s, e, n)).toBeLessThan((tolerance * reference) / 2);

    const area = await insertArea(client, {
      name: 'square 32N',
      geometry: box(w, s, e, n),
      userId,
    });
    expect(Math.abs(area.areaKm2 - reference) / reference).toBeLessThan(tolerance);
  });
});

describe('selectAreasInBounds', () => {
  const bbox: Bbox = [10, 50, 11, 51];

  it('returns only live areas whose box meets the bbox, most recently updated first', async () => {
    const inside = await insertArea(client, {
      name: 'inside',
      geometry: box(10.2, 50.2, 10.3, 50.3),
      userId,
    });
    const straddling = await insertArea(client, {
      name: 'straddling',
      geometry: box(10.9, 50.9, 11.1, 51.1),
      userId,
    });
    await insertArea(client, { name: 'outside', geometry: box(12, 52, 12.1, 52.1), userId });
    const deleted = await insertArea(client, {
      name: 'deleted',
      geometry: box(10.5, 50.5, 10.6, 50.6),
      userId,
    });
    expect(await softDeleteArea(client, deleted.id, userId)).toBe(2);

    const found = await selectAreasInBounds(client, bbox, { limit: LIMITS.BOUNDS_LIMIT });
    expect(found).toEqual([straddling, inside]);
    expect(await selectAreasInBounds(client, bbox, { limit: 1 })).toEqual([straddling]);
    expect(await selectAreasInBounds(client, bbox)).toEqual(found); // limit defaults to BOUNDS_LIMIT
  });

  it('uses the areas_geom_gist index once seeded and analysed', async () => {
    const { inserted: seeded } = await seedAreas(client);
    expect(seeded).toHaveLength(SEED.COUNT);
    const inSeedBbox = await selectAreasInBounds(client, SEED.BBOX, { limit: LIMITS.BOUNDS_LIMIT });
    expect(inSeedBbox.map((a) => a.id)).toEqual(expect.arrayContaining(seeded));

    await client.query('analyze areas');
    // A ~10 km viewport over Tel Aviv. At this table size a sequential scan costs less than any
    // index scan, so the planner is told not to use one: the assertion is that the index CAN serve
    // the query (its predicate matches the partial index), not that 50 rows need it.
    const viewport: Bbox = [34.75, 32.03, 34.85, 32.13];
    await client.query('begin');
    try {
      await client.query('set local enable_seqscan = off');
      const nodes = await explainBounds(viewport);
      expect(nodes).toContainEqual(
        expect.objectContaining({
          'Node Type': expect.stringMatching(/^(Index Scan|Bitmap Index Scan)$/),
          'Index Name': 'areas_geom_gist',
        }),
      );
    } finally {
      await client.query('rollback');
    }
  });
});

describe('updateAreaIfVersion', () => {
  it('updates name, geometry and area when the version matches, and records version 2', async () => {
    const area = await insertArea(client, {
      name: 'v1',
      geometry: box(21, 41, 21.01, 41.01),
      userId,
    });
    const geometry = box(21, 41, 21.02, 41.02);

    const result = updated(
      await updateAreaIfVersion(client, area.id, {
        name: 'v2',
        geometry,
        userId: 'editor',
        version: 1,
      }),
    );

    expect(AreaSchema.parse(result)).toEqual(result);
    expect(result).toMatchObject({
      id: area.id,
      name: 'v2',
      geometry,
      version: 2,
      createdBy: userId,
    });
    expect(result.areaKm2).toBeGreaterThan(3.9 * area.areaKm2); // twice as wide and tall
    expect(await versionRows(area.id)).toEqual([
      { version: 1, name: 'v1', changed_by: userId },
      { version: 2, name: 'v2', changed_by: 'editor' },
    ]);
  });

  it('returns the current row instead of writing when the version is stale', async () => {
    const area = await insertArea(client, {
      name: 'stale',
      geometry: box(22, 42, 22.01, 42.01),
      userId,
    });
    const input = { geometry: area.geometry, userId, version: 1 };
    const winner = updated(
      await updateAreaIfVersion(client, area.id, { ...input, name: 'winner' }),
    );

    const loser = await updateAreaIfVersion(client, area.id, { ...input, name: 'loser' });

    expect(loser).toEqual({ ok: false, current: winner });
    expect(winner.version).toBe(2);
    expect(await versionRows(area.id)).toHaveLength(2);
  });

  it('lets one of two concurrent same-version updates win; the other gets the winner row', async () => {
    const area = await insertArea(client, {
      name: 'race',
      geometry: box(23, 43, 23.01, 43.01),
      userId,
    });
    const [a, b] = [
      new pg.Client({ connectionString: url }),
      new pg.Client({ connectionString: url }),
    ];
    await Promise.all([a.connect(), b.connect()]);
    try {
      const { rows } = await b.query<{ pid: number }>('select pg_backend_pid() as pid');
      await a.query('begin');
      const first = updated(
        await updateAreaIfVersion(a, area.id, {
          name: 'a',
          geometry: area.geometry,
          userId: 'a',
          version: 1,
        }),
      );
      // b's UPDATE now waits for a's row lock; a commits; b re-checks the new row and matches nothing.
      const second = updateAreaIfVersion(b, area.id, {
        name: 'b',
        geometry: area.geometry,
        userId: 'b',
        version: 1,
      });
      await waitUntilBlocked(rows[0]!.pid);
      await a.query('commit');

      expect(first).toMatchObject({ version: 2, name: 'a' });
      // The current row is read after the failed UPDATE, so it is the committed winner (version 2),
      // not the version-1 row the UPDATE's own snapshot saw.
      expect(await second).toEqual({ ok: false, current: first });
    } finally {
      await Promise.all([a.end(), b.end()]);
    }
  });

  it('returns current: null for a missing or deleted area', async () => {
    const area = await insertArea(client, {
      name: 'gone',
      geometry: box(24, 44, 24.01, 44.01),
      userId,
    });
    await softDeleteArea(client, area.id, userId);
    const input = { name: 'x', geometry: area.geometry, userId, version: 2 };

    expect(await updateAreaIfVersion(client, area.id, input)).toEqual({ ok: false, current: null });
    expect(await updateAreaIfVersion(client, crypto.randomUUID(), input)).toEqual({
      ok: false,
      current: null,
    });
  });

  it('reports a stale version before an invalid polygon (409 before 422)', async () => {
    const area = await insertArea(client, {
      name: 'stale-bowtie',
      geometry: box(27, 47, 27.01, 47.01),
      userId,
    });
    const current = updated(
      await updateAreaIfVersion(client, area.id, {
        name: 'v2',
        geometry: area.geometry,
        userId,
        version: 1,
      }),
    );

    const result = await updateAreaIfVersion(client, area.id, {
      name: 'x',
      geometry: bowtie,
      userId,
      version: 1,
    });

    expect(result).toEqual({ ok: false, current });
  });

  it('reports a missing or deleted area before an invalid polygon (404 before 422)', async () => {
    const area = await insertArea(client, {
      name: 'gone-bowtie',
      geometry: box(28, 48, 28.01, 48.01),
      userId,
    });
    await softDeleteArea(client, area.id, userId);
    const input = { name: 'x', geometry: bowtie, userId, version: 2 };

    expect(await updateAreaIfVersion(client, area.id, input)).toEqual({ ok: false, current: null });
    expect(await updateAreaIfVersion(client, crypto.randomUUID(), input)).toEqual({
      ok: false,
      current: null,
    });
  });

  it('rejects a self-intersecting polygon and leaves the row as it was', async () => {
    const area = await insertArea(client, {
      name: 'keep',
      geometry: box(25, 45, 25.01, 45.01),
      userId,
    });
    const input = { name: 'bowtie', geometry: bowtie, userId, version: 1 };

    const error = await updateAreaIfVersion(client, area.id, input).catch((e) => e);

    expect(error).toBeInstanceOf(InvalidGeometryError);
    expect((error as InvalidGeometryError).reason).toMatch(/self-intersection/i);
    const [current] = await selectAreasInBounds(client, [25, 45, 25.01, 45.01]);
    expect(current).toEqual(area);
  });
});

describe('softDeleteArea', () => {
  it('hides the area, bumps its version by the deleting user, and is null the second time', async () => {
    const geometry = box(26, 46, 26.01, 46.01);
    const area = await insertArea(client, { name: 'doomed', geometry, userId });
    expect(await selectAreasInBounds(client, [26, 46, 26.01, 46.01])).toEqual([area]);

    expect(await softDeleteArea(client, area.id, 'deleter')).toBe(2);

    expect(await selectAreasInBounds(client, [26, 46, 26.01, 46.01])).toEqual([]);
    expect(
      await count('areas where id = $1 and deleted_at is not null and version = 2', [area.id]),
    ).toBe(1);
    expect(await versionRows(area.id)).toEqual([
      { version: 1, name: 'doomed', changed_by: userId },
      { version: 2, name: 'doomed', changed_by: 'deleter' },
    ]);
    expect(await softDeleteArea(client, area.id, 'deleter')).toBeNull();
    expect(await softDeleteArea(client, crypto.randomUUID(), 'deleter')).toBeNull();
  });
});

describe('writeAudit', () => {
  it('appends one audit_log row', async () => {
    const entityId = crypto.randomUUID();
    await writeAudit(client, {
      userId,
      action: 'area.create',
      entity: 'area',
      entityId,
      version: 1,
      ip: '203.0.113.7',
    });
    await writeAudit(client, { action: 'auth.sign_in_failed', entity: 'session' });

    const { rows } = await client.query(
      'select user_id, action, entity, entity_id, version, ip, user_agent from audit_log where entity_id = $1',
      [entityId],
    );
    expect(rows).toEqual([
      {
        user_id: userId,
        action: 'area.create',
        entity: 'area',
        entity_id: entityId,
        version: 1,
        ip: '203.0.113.7',
        user_agent: null,
      },
    ]);
    expect(
      await count("audit_log where action = 'auth.sign_in_failed' and user_id is null", []),
    ).toBeGreaterThan(0);
  });
});

/** Polls until `pid` waits on a lock held by another backend (a's transaction). */
async function waitUntilBlocked(pid: number): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt++) {
    const { rows } = await client.query<{ blocked: boolean }>(
      'select cardinality(pg_blocking_pids($1)) > 0 as blocked',
      [pid],
    );
    if (rows[0]!.blocked) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`backend ${pid} never blocked`);
}
