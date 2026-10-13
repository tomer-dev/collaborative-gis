import { describe, expect, it } from 'vitest';
import * as constants from './constants';
import * as shared from './index';

describe('constants', () => {
  it('every export of the constants barrel is a non-empty group that @cgis/shared re-exports', () => {
    const fromShared = new Map(Object.entries(shared));
    const groups = Object.entries(constants);
    expect(groups.length).toBeGreaterThan(0);
    for (const [name, group] of groups) {
      expect(group, name).toBeTypeOf('object');
      expect(Object.keys(group).length, name).toBeGreaterThan(0);
      expect(fromShared.get(name), name).toBe(group);
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

  it('POLYGON_MAX_PLACED_VERTICES is the ring cap minus the closing vertex', () => {
    expect(shared.LIMITS.POLYGON_MAX_PLACED_VERTICES).toBe(shared.LIMITS.POLYGON_MAX_VERTICES - 1);
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

  it('the area name hint states LIMITS.AREA_NAME_MAX; the diff note carries both values', () => {
    expect(shared.COPY.AREAS.NAME_HINT).toContain(String(shared.LIMITS.AREA_NAME_MAX));
    const note = shared.COPY.AREAS.AREA_DIFF_NOTE('1.240 km²', '1.234 km²');
    expect(note).toContain('1.240 km²');
    expect(note).toContain('1.234 km²');
    expect(shared.MAP.AREA_DIFF_WARN_RATIO).toBe(0.005);
  });
});
