import { describe, expect, it } from 'vitest';
import { AreaVersionSchema, BoundsQuerySchema } from './index';

const polygon = {
  type: 'Polygon' as const,
  coordinates: [
    [
      [34.8, 32.0],
      [34.9, 32.0],
      [34.9, 32.1],
      [34.8, 32.0],
    ],
  ],
};

describe('AreaVersionSchema', () => {
  const entry = {
    areaId: '3f8b6c1e-2a4d-4e5f-9a7b-1c2d3e4f5a6b',
    version: 1,
    name: 'Yarkon park',
    geometry: polygon,
    areaKm2: 12.3,
    changedBy: 'user-1',
    changedAt: '2026-10-12T10:00:00Z',
  };

  it('parses a valid history entry and rejects version 0', () => {
    expect(AreaVersionSchema.safeParse(entry).success).toBe(true);
    expect(AreaVersionSchema.safeParse({ ...entry, version: 0 }).success).toBe(false);
  });
});

describe('BoundsQuerySchema', () => {
  const bbox = '34.7,31.9,35.0,32.2';

  it('treats an empty zoom as absent, not as zoom 0', () => {
    const r = BoundsQuerySchema.safeParse({ bbox, zoom: '' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.zoom).toBeUndefined();
  });

  it('still coerces a zoom string and accepts a missing zoom', () => {
    expect(BoundsQuerySchema.parse({ bbox, zoom: '12' }).zoom).toBe(12);
    expect(BoundsQuerySchema.parse({ bbox }).zoom).toBeUndefined();
  });
});
