import type { Polygon } from '@cgis/shared';
import { eq } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { db } from '../../src/db';
import { areas } from '../../src/db/schema';
import { insertArea, selectAreasInBounds } from '../../src/db/spatial';

const client = new pg.Client({ connectionString: inject('databaseUrl') });
beforeAll(() => client.connect());
afterAll(() => client.end());

// Its own region (lng 28, lat 48): the db test files share cgis_db and run in parallel.
const triangle: Polygon = {
  type: 'Polygon',
  coordinates: [
    [
      [28, 48],
      [28.02, 48],
      [28.01, 48.02],
      [28, 48],
    ],
  ],
};

describe('polygon column', () => {
  it('refuses raw geometry reads, while the spatial helpers return GeoJSON', async () => {
    const area = await insertArea(client, {
      name: 'raw read',
      geometry: triangle,
      userId: 'user-geo',
    });

    await expect(
      db(client).select({ geom: areas.geom }).from(areas).where(eq(areas.id, area.id)).execute(),
    ).rejects.toThrow(
      'read areas.geom through ST_AsGeoJSON(geom)::json (see spatial.ts); raw geometry reads are not supported',
    );
    expect(area.geometry).toEqual(triangle);
    expect(await selectAreasInBounds(client, [28, 48, 28.02, 48.02])).toEqual([area]);
  });
});
