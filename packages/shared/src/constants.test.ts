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
      'ERROR_CODES',
      'ERROR_MESSAGES',
      'QUERY',
      'COPY',
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

  it('the Better Auth endpoint paths sit under ROUTES.AUTH', () => {
    const { AUTH, AUTH_SIGN_UP, AUTH_SIGN_IN, AUTH_SIGN_OUT, AUTH_GET_SESSION } = shared.ROUTES;
    expect([AUTH_SIGN_UP, AUTH_SIGN_IN, AUTH_SIGN_OUT, AUTH_GET_SESSION]).toEqual([
      `${AUTH}/sign-up/email`,
      `${AUTH}/sign-in/email`,
      `${AUTH}/sign-out`,
      `${AUTH}/get-session`,
    ]);
  });

  it('the password hint states LIMITS.PASSWORD_MIN', () => {
    expect(shared.COPY.AUTH.PASSWORD_HINT).toContain(String(shared.LIMITS.PASSWORD_MIN));
  });
});
