import { describe, expect, it } from 'vitest';
import { AreaUpdateSchema, AreaVersionSchema, BoundsQuerySchema, LIMITS } from './index';

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

describe('AreaUpdateSchema', () => {
  const update = { name: 'Yarkon park', geometry: polygon };

  it('accepts versions up to LIMITS.VERSION_MAX (the Postgres integer max) and nothing past it', () => {
    expect(LIMITS.VERSION_MAX).toBe(2_147_483_647);
    expect(AreaUpdateSchema.safeParse({ ...update, version: LIMITS.VERSION_MAX }).success).toBe(
      true,
    );
    expect(AreaUpdateSchema.safeParse({ ...update, version: LIMITS.VERSION_MAX + 1 }).success).toBe(
      false,
    );
    expect(AreaUpdateSchema.safeParse({ ...update, version: 1e300 }).success).toBe(false);
  });
});

describe('BoundsQuerySchema', () => {
  const bbox = '34.7,31.9,35.0,32.2';

  it('treats an empty zoom as absent, not as zoom 0', () => {
    const r = BoundsQuerySchema.safeParse({ bbox, zoom: '' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.zoom).toBeUndefined();
  });

  it('parses w,s,e,n into numbers', () => {
    expect(BoundsQuerySchema.parse({ bbox }).bbox).toEqual([34.7, 31.9, 35, 32.2]);
  });

  it.each([',,35,32', '34.7, ,35,32', '34.7,31.9,35,', 'a,31.9,35,32.2', '34.7,31.9,35'])(
    'rejects %j: empty, blank, non-numeric or missing parts are not 0',
    (bad) => {
      expect(BoundsQuerySchema.safeParse({ bbox: bad }).success).toBe(false);
    },
  );

  it('still coerces a zoom string and accepts a missing zoom', () => {
    expect(BoundsQuerySchema.parse({ bbox, zoom: '12' }).zoom).toBe(12);
    expect(BoundsQuerySchema.parse({ bbox }).zoom).toBeUndefined();
  });
});
