import { describe, expect, it } from 'vitest';
import { LIMITS } from './constants';
import { PolygonSchema } from './geo';

const square = (n = 0) => ({
  type: 'Polygon' as const,
  coordinates: [
    [
      [34.8 + n, 32.0],
      [34.9 + n, 32.0],
      [34.9 + n, 32.1],
      [34.8 + n, 32.1],
      [34.8 + n, 32.0],
    ],
  ],
});

describe('PolygonSchema', () => {
  it('accepts a closed square near Tel Aviv', () => {
    expect(PolygonSchema.safeParse(square()).success).toBe(true);
  });

  it('rejects an unclosed ring and names the rule', () => {
    const open = square();
    open.coordinates[0] = open.coordinates[0]!.slice(0, -1);
    const r = PolygonSchema.safeParse(open);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toMatch(/closed/i);
  });

  it('rejects a ring shorter than the 4-position minimum', () => {
    const line = {
      type: 'Polygon' as const,
      coordinates: [
        [
          [34.8, 32.0],
          [34.9, 32.0],
          [34.8, 32.0],
        ],
      ],
    };
    expect(PolygonSchema.safeParse(line).success).toBe(false);
  });

  it('rejects a closed 4-position ring with only 2 unique vertices', () => {
    const degenerate = {
      type: 'Polygon' as const,
      coordinates: [
        [
          [34.8, 32.0],
          [34.9, 32.0],
          [34.8, 32.0],
          [34.8, 32.0],
        ],
      ],
    };
    const r = PolygonSchema.safeParse(degenerate);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toMatch(/unique/i);
  });

  it('rejects an empty ring instead of throwing', () => {
    const empty = { type: 'Polygon' as const, coordinates: [[]] };
    expect(PolygonSchema.safeParse(empty).success).toBe(false);
  });

  it('rejects out-of-range longitude', () => {
    const bad = square();
    bad.coordinates[0]![0] = [181, 32.0];
    expect(PolygonSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects out-of-range latitude', () => {
    const bad = square();
    bad.coordinates[0]![1] = [34.9, 91];
    expect(PolygonSchema.safeParse(bad).success).toBe(false);
  });

  it('accepts exactly 1000 vertices and rejects 1001', () => {
    const ring = (n: number) => {
      const pts: [number, number][] = [];
      for (let i = 0; i < n - 1; i++) {
        const a = (i / (n - 1)) * 2 * Math.PI;
        pts.push([34.85 + 0.01 * Math.cos(a), 32.05 + 0.01 * Math.sin(a)]);
      }
      pts.push(pts[0]!);
      return { type: 'Polygon' as const, coordinates: [pts] };
    };
    expect(PolygonSchema.safeParse(ring(LIMITS.POLYGON_MAX_VERTICES)).success).toBe(true);
    expect(PolygonSchema.safeParse(ring(LIMITS.POLYGON_MAX_VERTICES + 1)).success).toBe(false);
  });

  it('cannot detect swapped lng/lat when both are in range (documented limitation)', () => {
    const swapped = {
      type: 'Polygon' as const,
      coordinates: [
        [
          [32.0, 34.8],
          [32.0, 34.9],
          [32.1, 34.9],
          [32.0, 34.8],
        ],
      ],
    };
    expect(PolygonSchema.safeParse(swapped).success).toBe(true);
  });
});
