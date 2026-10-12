import { SEED, type Polygon } from '@cgis/shared';
import type pg from 'pg';
import { insertArea, type AreaRow, type Bbox } from './spatial';

/**
 * Inserts `count` random polygons inside `bbox` through `insertArea`, so each gets its real
 * `area_km2` and version row. Test data only (the 10k benchmark seed is M2).
 *
 * Each polygon is star-shaped around its centre: vertices at strictly increasing angles (gaps under
 * π) and positive radii never cross, so every ring passes `ST_IsValid`.
 */
export async function seedAreas(
  c: pg.Client,
  {
    count = SEED.COUNT,
    bbox = SEED.BBOX,
    userId = SEED.USER_ID,
    random = Math.random,
  }: { count?: number; bbox?: Bbox; userId?: string; random?: () => number } = {},
): Promise<AreaRow[]> {
  const areas: AreaRow[] = [];
  for (let i = 0; i < count; i++) {
    const geometry = randomPolygon(bbox, random);
    areas.push(await insertArea(c, { name: `seed ${i + 1}`, geometry, userId }));
  }
  return areas;
}

function randomPolygon([west, south, east, north]: Bbox, random: () => number): Polygon {
  const r = SEED.MAX_RADIUS_DEG;
  const between = (min: number, max: number) => min + random() * (max - min);
  const [cx, cy] = [between(west + r, east - r), between(south + r, north - r)];
  const { min, max } = SEED.VERTICES;
  const n = Math.floor(between(min, max + 1));
  const step = (2 * Math.PI) / n;

  const ring = Array.from({ length: n }, (_, k): [number, number] => {
    const angle = (k + random() / 2) * step; // jitter < step/2 keeps angles increasing, gaps < π
    const radius = between(r / 2, r);
    return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)];
  });
  return { type: 'Polygon', coordinates: [[...ring, ring[0]!]] };
}
