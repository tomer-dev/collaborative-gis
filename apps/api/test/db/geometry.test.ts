import type { Polygon } from '@cgis/shared';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { polygonFromEwkb } from '../../src/db/geometry';

const client = new pg.Client({ connectionString: inject('databaseUrl') });
beforeAll(() => client.connect());
afterAll(() => client.end());

/** Lets PostGIS encode the WKB, so the parser is checked against the real format. */
async function wkbHex(geometrySql: string, byteOrder: 'NDR' | 'XDR'): Promise<string> {
  const { rows } = await client.query(
    `select encode(ST_AsBinary(${geometrySql}, $1), 'hex') as hex`,
    [byteOrder],
  );
  return rows[0].hex;
}

const triangle: Polygon = {
  type: 'Polygon',
  coordinates: [
    [
      [34.78, 32.08],
      [34.8, 32.08],
      [34.79, 32.1],
      [34.78, 32.08],
    ],
  ],
};

describe('polygonFromEwkb', () => {
  it('reads big-endian WKB without an SRID', async () => {
    const hex = await wkbHex(`ST_GeomFromGeoJSON('${JSON.stringify(triangle)}')`, 'XDR');
    expect(polygonFromEwkb(hex)).toEqual(triangle);
  });

  it('rejects anything but a single-ring polygon', async () => {
    expect(() => polygonFromEwkb('0101000000000000000000F03F0000000000000040')).toThrow(
      /expected a 2D polygon/,
    ); // POINT(1 2)
    const withHole = await wkbHex(
      `'POLYGON((0 0,10 0,10 10,0 10,0 0),(2 2,2 3,3 3,3 2,2 2))'::geometry`,
      'NDR',
    );
    expect(() => polygonFromEwkb(withHole)).toThrow(/with 2 rings/);
  });
});
