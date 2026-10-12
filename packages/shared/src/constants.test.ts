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
      'ROOM',
      'MAP',
      'DRAW',
      'ERROR_CODES',
      'ERROR_MESSAGES',
      'WS_MESSAGES',
      'COPY',
      'OPENAPI',
      'AUDIT',
      'QUERY',
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

  it('the WS client thresholds are ordered and the ping beats the Room idle sweep', () => {
    expect(shared.WS.CLIENT_DEGRADED_AFTER).toBeLessThan(shared.WS.CLIENT_OFFLINE_AFTER);
    expect(shared.WS.PING_INTERVAL_MS).toBeLessThan(shared.WS.PRESENCE_IDLE_MS);
    expect(shared.WS.CLIENT_BACKOFF_JITTER).toBeGreaterThan(0);
    expect(shared.WS.CLIENT_BACKOFF_JITTER).toBeLessThan(1);
  });

  it('the offline banner states WS.OFFLINE_POLL_MS in seconds', () => {
    expect(shared.COPY.CONNECTION.OFFLINE_DETAIL).toContain(
      `every ${shared.WS.OFFLINE_POLL_MS / 1000} s`,
    );
  });

  it('the password hint states LIMITS.PASSWORD_MIN', () => {
    expect(shared.COPY.AUTH.PASSWORD_HINT).toContain(String(shared.LIMITS.PASSWORD_MIN));
  });
});
