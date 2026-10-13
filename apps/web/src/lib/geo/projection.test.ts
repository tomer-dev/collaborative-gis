import { GOVMAP } from '@cgis/shared';
import proj4 from 'proj4';
import { describe, expect, it } from 'vitest';
import { itmToWgs84, wgs84ToItm } from './projection';

/**
 * WGS 84 → EPSG:2039 computed with PROJ 9.5.1 and EPSG:9676 (research-govmap-spike §2.3). The
 * first row feeds the ITM natural origin's coordinates in as WGS 84, so it carries the datum shift.
 */
const CONTROL_POINTS = [
  {
    name: 'ITM origin as WGS 84',
    lngLat: [35.2045169444444, 31.7343936111111],
    itm: [219463.548, 626866.427],
  },
  { name: 'Dizengoff fountain', lngLat: [34.7741951, 32.0779953], itm: [178834.838, 665048.202] },
  { name: 'Dizengoff Square', lngLat: [34.774, 32.0779], itm: [178816.375, 665037.708] },
  { name: 'Western Wall plaza', lngLat: [35.2345, 31.7767], itm: [222303.615, 631557.918] },
  { name: 'Bahá’í Gardens', lngLat: [34.9873, 32.8148], itm: [199121.224, 746696.793] },
  { name: 'Be’er Sheva', lngLat: [34.7913, 31.2518], itm: [180103.074, 573430.358] },
  { name: 'Eilat', lngLat: [34.9519, 29.5577], itm: [194982.116, 385574.285] },
] as const;

/** The 1 m requirement holds with room to spare; proj4 matches PROJ to ≤ 0.001 m. */
const TOLERANCE_M = 0.01;
const TOLERANCE_DEG = 1e-8;

describe('wgs84ToItm', () => {
  it.each(CONTROL_POINTS)('projects $name within 0.01 m of PROJ', ({ lngLat, itm }) => {
    const [x, y] = wgs84ToItm(lngLat);
    expect(Math.abs(x - itm[0])).toBeLessThan(TOLERANCE_M);
    expect(Math.abs(y - itm[1])).toBeLessThan(TOLERANCE_M);
  });
});

describe('itmToWgs84', () => {
  it.each(CONTROL_POINTS)('brings $name back to lng/lat within 1e-8°', ({ lngLat, itm }) => {
    const [lng, lat] = itmToWgs84(itm);
    expect(Math.abs(lng - lngLat[0])).toBeLessThan(TOLERANCE_DEG);
    expect(Math.abs(lat - lngLat[1])).toBeLessThan(TOLERANCE_DEG);
  });
});

describe('WGS 84 → ITM → WGS 84 round trip', () => {
  // A 0.5° grid over Israel's extent (29.5–33.5°N, 34.25–35.75°E), beyond the control points.
  const grid = [29.5, 30, 30.5, 31, 31.5, 32, 32.5, 33, 33.5].flatMap((lat) =>
    [34.25, 34.75, 35.25, 35.75].map((lng): [number, number] => [lng, lat]),
  );

  it.each(grid)('returns [%f, %f] to itself within 1e-8°', (lng, lat) => {
    const [backLng, backLat] = itmToWgs84(wgs84ToItm([lng, lat]));
    expect(Math.abs(backLng - lng)).toBeLessThan(TOLERANCE_DEG);
    expect(Math.abs(backLat - lat)).toBeLessThan(TOLERANCE_DEG);
  });
});

describe('GOVMAP.ITM_PROJ4', () => {
  it('carries the EPSG:9676 datum shift in position-vector signs', () => {
    // Missing, it moves positions by about 78 m; with coordinate-frame signs, by about 155 m.
    expect(GOVMAP.ITM_PROJ4).toContain(
      '+towgs84=23.772,17.49,17.859,-0.3132,-1.85274,1.67299,-5.4262',
    );
  });

  it('puts the natural origin at the false easting and northing without the datum shift', () => {
    // Isolates the tmerc parameters: on the local datum the origin maps to (x_0, y_0) exactly.
    const tmercOnly = GOVMAP.ITM_PROJ4.replace(/\+towgs84=\S+ /, '');
    const [x, y] = proj4(tmercOnly).forward([35.2045169444444, 31.7343936111111]);
    expect(x).toBeCloseTo(219529.584, 3);
    expect(y).toBeCloseTo(626907.39, 3);
  });
});
