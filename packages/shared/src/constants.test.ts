import { describe, expect, it } from 'vitest';
import * as shared from './index';

describe('constants', () => {
  it('the barrel exports every constant group as a non-empty object', () => {
    const groups = [
      'LIMITS',
      'WS',
      'TIMEOUTS',
      'ROUTES',
      'DEV',
      'ROOM',
      'MAP',
      'GEO',
      'DRAW',
      'AREA_FORMAT',
      'ERROR_CODES',
      'ERROR_MESSAGES',
    ] as const;
    for (const name of groups) {
      const group: unknown = shared[name];
      expect(group, name).toBeTypeOf('object');
      expect(Object.keys(group as object).length, name).toBeGreaterThan(0);
    }
  });

  it('every error code has a default message', () => {
    expect(Object.keys(shared.ERROR_MESSAGES)).toEqual(Object.keys(shared.ERROR_CODES));
  });

  it('MAP has the draw-handle sizes and GEO the WGS84 mean radius', () => {
    expect(shared.MAP.HANDLE_RADIUS_PX).toBe(6);
    expect(shared.MAP.HANDLE_HIT_PX).toBe(24);
    expect(shared.GEO.EARTH_RADIUS_M).toBe(6371008.8);
    expect(shared.MAP.DRAFT_STYLE.weight).toBeGreaterThan(0);
  });

  it('POLYGON_MAX_VERTICES keeps its old import path and matches LIMITS', () => {
    expect(shared.POLYGON_MAX_VERTICES).toBe(shared.LIMITS.POLYGON_MAX_VERTICES);
  });
});
