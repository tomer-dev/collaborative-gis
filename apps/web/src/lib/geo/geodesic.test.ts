import { GEO } from '@cgis/shared';
import { describe, expect, it } from 'vitest';
import { ringAreaKm2, ringAreaM2, type LngLat } from './geodesic';

const rad = (deg: number) => (deg * Math.PI) / 180;
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

/** Exact area of a lat/lon box on a sphere of radius r: r² · |Δλ| · |sin φ2 − sin φ1|. */
function sphereBoxM2(r: number): number {
  return r * r * Math.abs(rad(E - W)) * Math.abs(Math.sin(rad(N)) - Math.sin(rad(S)));
}

/**
 * Exact area of the same box on the WGS84 ellipsoid (parallels and meridians as edges):
 * Δλ · (F(φ2) − F(φ1)), F(φ) = b²/2 · [sin φ / (1 − e² sin² φ) + atanh(e sin φ) / e],
 * the area between the equator and φ per radian of longitude (authalic-latitude integral).
 */
function ellipsoidBoxM2(): number {
  const a = 6378137;
  const f = 1 / 298.257223563;
  const e2 = f * (2 - f);
  const e = Math.sqrt(e2);
  const b = a * (1 - f);
  const F = (phi: number) => {
    const s = Math.sin(rad(phi));
    return ((b * b) / 2) * (s / (1 - e2 * s * s) + Math.atanh(e * s) / e);
  };
  return rad(E - W) * (F(N) - F(S));
}

/** L'Huilier's theorem: spherical excess of a great-circle triangle, times R². */
function lhuilierM2(p: LngLat, q: LngLat, r: LngLat): number {
  const arc = ([l1, f1]: LngLat, [l2, f2]: LngLat) => {
    const h =
      Math.sin(rad(f2 - f1) / 2) ** 2 +
      Math.cos(rad(f1)) * Math.cos(rad(f2)) * Math.sin(rad(l2 - l1) / 2) ** 2;
    return 2 * Math.asin(Math.sqrt(h));
  };
  const [a, b, c] = [arc(q, r), arc(p, r), arc(p, q)];
  const s = (a + b + c) / 2;
  const t = Math.tan(s / 2) * Math.tan((s - a) / 2) * Math.tan((s - b) / 2) * Math.tan((s - c) / 2);
  return 4 * Math.atan(Math.sqrt(t)) * GEO.EARTH_RADIUS_M ** 2;
}

describe('ringAreaM2 / ringAreaKm2 (spherical excess, Chamberlain & Duquette 2007)', () => {
  it('matches the exact sphere area of a 0.1° box at 32°N within 0.01 %', () => {
    expect(relErr(ringAreaM2(box), sphereBoxM2(GEO.EARTH_RADIUS_M))).toBeLessThan(1e-4);
  });

  it('is within 0.5 % of the WGS84 ellipsoid area of the same box (server ST_Area(geography))', () => {
    const ellipsoid = ellipsoidBoxM2();
    // The derivation in the T11a report: 104.7243 km², and PostGIS 3.6.1 agrees:
    // ST_Area('POLYGON((34.9 32,35 32,35 32.1,34.9 32.1,34.9 32))'::geography) = 104724346.46 m².
    expect(ellipsoid / 1e6).toBeCloseTo(104.7243, 3);
    expect(relErr(ringAreaKm2(box), ellipsoid / 1e6)).toBeLessThan(0.005);
    expect(relErr(ringAreaKm2(box), 104724346.46 / 1e6)).toBeLessThan(0.005);
  });

  it('computes a triangle within 0.1 % of the great-circle (L’Huilier) area', () => {
    const p: LngLat = [W, S];
    const q: LngLat = [E, S];
    const r: LngLat = [W, N];
    expect(relErr(ringAreaM2([p, q, r, p]), lhuilierM2(p, q, r))).toBeLessThan(1e-3);
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
