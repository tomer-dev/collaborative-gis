import type { LngLat } from './geodesic';

type Pt = readonly [number, number];

const same = (a: Pt, b: Pt) => a[0] === b[0] && a[1] === b[1];
/** Twice the signed area of triangle o-a-b: > 0 left turn, < 0 right turn, 0 collinear. */
const cross = (o: Pt, a: Pt, b: Pt) =>
  (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
/** q is collinear with p-r: does it lie within the segment's bounding box? */
const within = (p: Pt, q: Pt, r: Pt) =>
  Math.min(p[0], r[0]) <= q[0] &&
  q[0] <= Math.max(p[0], r[0]) &&
  Math.min(p[1], r[1]) <= q[1] &&
  q[1] <= Math.max(p[1], r[1]);

/** Do segments a-b and c-d share any point (touching and collinear overlap included)? */
function segmentsIntersect(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }
  return (
    (d1 === 0 && within(c, a, d)) ||
    (d2 === 0 && within(c, b, d)) ||
    (d3 === 0 && within(a, c, b)) ||
    (d4 === 0 && within(a, d, b))
  );
}

/** Adjacent edges p-q and q-r fold back over each other (a spike) when collinear and pointing the same way from q. */
const foldsBack = (p: Pt, q: Pt, r: Pt) =>
  cross(p, q, r) === 0 && (p[0] - q[0]) * (r[0] - q[0]) + (p[1] - q[1]) * (r[1] - q[1]) > 0;

/**
 * Does the ring (open or closed, `[lng, lat]`) cross or touch itself? Planar test in degrees,
 * which is what the client needs before `POST /areas`; the server's `ST_IsValid` stays the
 * authority. Adjacent edges may share their endpoint but must not fold back; consecutive
 * duplicate vertices are ignored, as PostGIS accepts repeated points.
 *
 * ponytail: O(n²) pairwise check, ~500k pairs at the 1,000-vertex cap. Upgrade to
 * Bentley–Ottmann (O((n + k) log n)) if more than 1,000 vertices are ever allowed.
 */
export function hasSelfIntersection(ring: readonly LngLat[]): boolean {
  const pts = ring.filter((p, i) => i === 0 || !same(p, ring[i - 1]!));
  if (pts.length > 1 && same(pts[0]!, pts[pts.length - 1]!)) pts.pop();
  const n = pts.length;
  if (n < 3) return false;

  for (let i = 0; i < n; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % n]!;
    for (let j = i + 1; j < n; j++) {
      const c = pts[j]!;
      const d = pts[(j + 1) % n]!;
      if (j === i + 1) {
        if (foldsBack(a, b, d)) return true; // a-b then b-d
      } else if (i === 0 && j === n - 1) {
        if (foldsBack(c, a, b)) return true; // c-a (closing edge) then a-b
      } else if (segmentsIntersect(a, b, c, d)) {
        return true;
      }
    }
  }
  return false;
}
