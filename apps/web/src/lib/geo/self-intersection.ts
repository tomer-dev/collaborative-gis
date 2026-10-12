import { kinks } from '@turf/kinks';
import { closedRing, type LngLat } from './geodesic';

const same = (a: LngLat, b: LngLat) => a[0] === b[0] && a[1] === b[1];

/**
 * Supplement to kinks, which skips adjacent segments and treats collinear ones as parallel:
 * edges p-q and q-r fold back over each other when collinear and pointing the same way from q.
 * Catches the zero-area collinear ring (every pair of its edges is adjacent).
 */
const foldsBack = (p: LngLat, q: LngLat, r: LngLat) =>
  (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]) === 0 &&
  (p[0] - q[0]) * (r[0] - q[0]) + (p[1] - q[1]) * (r[1] - q[1]) > 0;

/**
 * Does the ring (open or closed, `[lng, lat]`) cross or touch itself? `@turf/kinks` on the
 * closed ring plus the fold-back check above: a planar test in degrees, which is what the
 * client needs before `POST /areas`; the server's `ST_IsValid` stays the authority.
 * Consecutive duplicate vertices are dropped first: PostGIS accepts repeated points, but
 * kinks reports one as a self-intersection.
 */
export function hasSelfIntersection(ring: readonly LngLat[]): boolean {
  const pts = closedRing(ring.filter((p, i) => i === 0 || !same(p, ring[i - 1]!)));
  if (pts.length < 4) return false;
  const n = pts.length - 1; // distinct vertices; pts[n] repeats pts[0]
  if (pts.slice(0, n).some((q, i) => foldsBack(pts[(i + n - 1) % n]!, q, pts[i + 1]!))) {
    return true;
  }
  return kinks({ type: 'Polygon', coordinates: [pts] }).features.length > 0;
}
