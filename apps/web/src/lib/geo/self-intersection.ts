import { kinks } from '@turf/kinks';
import { closeRing, type LngLat } from './geodesic';

const same = (a: LngLat, b: LngLat) => a[0] === b[0] && a[1] === b[1];

/**
 * Does the ring (open or closed, `[lng, lat]`) cross or touch itself? Drops consecutive
 * duplicate vertices (PostGIS accepts repeated points, kinks would report one), closes the
 * ring, and returns whether `@turf/kinks` finds any self-intersection. Best-effort and planar
 * in degrees: kinks skips adjacent edges and treats collinear ones as parallel, so a
 * zero-area fold-back passes here; the server's `ST_IsValid` rejects it with a reason.
 */
export function hasSelfIntersection(ring: readonly LngLat[]): boolean {
  const pts = closeRing(ring.filter((p, i) => i === 0 || !same(p, ring[i - 1]!)));
  if (pts.length < 4) return false;
  return kinks({ type: 'Polygon', coordinates: [pts] }).features.length > 0;
}
