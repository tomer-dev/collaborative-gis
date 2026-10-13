import { describe, expect, it } from 'vitest';
import { ringAreaKm2, ringAreaM2, type LngLat } from './geodesic';

const relErr = (actual: number, expected: number) => Math.abs(actual / expected - 1);

// 0.1° x 0.1° lat/lon box at 32°N (central Israel), counter-clockwise, closed.
const W = 34.9;
const E = 35;
const S = 32;
const N = 32.1;
const box: LngLat[] = [
  [W, S],
  [E, S],
  [E, N],
  [W, N],
  [W, S],
];

describe('ringAreaM2 / ringAreaKm2 (spherical excess, Chamberlain & Duquette 2007)', () => {
  it('is within 0.5 % of PostGIS for a 0.1° box at 32°N (server ST_Area(geography))', () => {
    // PostGIS 3.6.1: ST_Area('POLYGON((34.9 32,35 32,35 32.1,34.9 32.1,34.9 32))'::geography)
    // = 104724346.46 m².
    expect(relErr(ringAreaKm2(box), 104724346.46 / 1e6)).toBeLessThan(0.005);
  });

  it('returns 0 for fewer than 3 vertices', () => {
    expect(ringAreaM2([])).toBe(0);
    expect(ringAreaM2([[W, S]])).toBe(0);
    expect(
      ringAreaM2([
        [W, S],
        [E, S],
      ]),
    ).toBe(0);
    // Closed ring with only 2 distinct vertices.
    expect(
      ringAreaM2([
        [W, S],
        [E, S],
        [W, S],
      ]),
    ).toBe(0);
  });

  it('is positive regardless of ring orientation', () => {
    const clockwise = [...box].reverse();
    expect(ringAreaM2(clockwise)).toBeGreaterThan(0);
    expect(ringAreaM2(clockwise)).toBeCloseTo(ringAreaM2(box), 6);
  });

  it('gives the same result for the open and the closed ring', () => {
    expect(ringAreaM2(box.slice(0, -1))).toBeCloseTo(ringAreaM2(box), 6);
  });

  it('ringAreaKm2 is ringAreaM2 / 1e6', () => {
    expect(ringAreaKm2(box)).toBeCloseTo(ringAreaM2(box) / 1e6, 9);
  });
});
