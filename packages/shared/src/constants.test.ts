import { describe, expect, it } from 'vitest';
import * as shared from './index';

describe('constants', () => {
  it('the barrel exports every constant group as a non-empty object', () => {
    const groups = [
      'LIMITS',
      'GEO',
      'SEED',
      'WS',
      'TIMEOUTS',
      'ROUTES',
      'DEV',
      'HEADERS',
      'ROOM',
      'MAP',
      'DRAW',
      'ERROR_CODES',
      'ERROR_MESSAGES',
      'ERROR_REASONS',
      'WS_MESSAGES',
      'OPENAPI',
      'AUDIT',
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

  it('MAP has the draw-handle hit size (the look is CSS) and GEO the WGS84 mean radius', () => {
    expect(shared.MAP.HANDLE_HIT_PX).toBe(24);
    expect(Object.keys(shared.MAP)).not.toContain('HANDLE_RADIUS_PX');
    expect(Object.keys(shared.MAP)).not.toContain('HANDLE_BORDER_PX');
    expect(Object.keys(shared.DRAW)).not.toContain('ARIA_LABEL');
    expect(shared.GEO.EARTH_RADIUS_M).toBe(6371008.8);
    expect(shared.MAP.DRAFT_STYLE.weight).toBeGreaterThan(0);
  });

  it('POLYGON_MAX_VERTICES keeps its old import path and matches LIMITS', () => {
    expect(shared.POLYGON_MAX_VERTICES).toBe(shared.LIMITS.POLYGON_MAX_VERTICES);
  });
});
