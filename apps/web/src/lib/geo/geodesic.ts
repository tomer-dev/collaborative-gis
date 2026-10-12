import { GEO, type Position } from '@cgis/shared';

/** A GeoJSON position, `[longitude, latitude]` in degrees (the shared `Position`). */
export type LngLat = Position;

const rad = (deg: number) => (deg * Math.PI) / 180;

/**
 * Area of a ring on the WGS84 mean sphere (`GEO.EARTH_RADIUS_M`), in m².
 *
 * Spherical excess after Chamberlain & Duquette (2007), "Some Algorithms for Polygons on a
 * Sphere": A = R²/2 · |Σ (λ[i+1] − λ[i−1]) · sin φ[i]|. Works for open or closed rings and
 * either orientation; fewer than 3 vertices gives 0. Does not handle rings that cross the
 * antimeridian or contain a pole (out of scope for the single Israel-centred map).
 */
export function ringAreaM2(ring: readonly LngLat[]): number {
  const first = ring[0];
  const last = ring[ring.length - 1];
  const closed = ring.length > 1 && first![0] === last![0] && first![1] === last![1];
  const n = closed ? ring.length - 1 : ring.length;
  if (n < 3) return 0;

  let sum = 0;
  for (let i = 0; i < n; i++) {
    const prev = ring[(i + n - 1) % n]!;
    const next = ring[(i + 1) % n]!;
    sum += (rad(next[0]) - rad(prev[0])) * Math.sin(rad(ring[i]![1]));
  }
  return (Math.abs(sum) * GEO.EARTH_RADIUS_M ** 2) / 2;
}

/** `ringAreaM2` in km², the unit the UI and `area_km2` use. */
export function ringAreaKm2(ring: readonly LngLat[]): number {
  return ringAreaM2(ring) / 1e6;
}
