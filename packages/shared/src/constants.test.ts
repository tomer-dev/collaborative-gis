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
      'ERROR_CODES',
      'ERROR_MESSAGES',
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

  it('POLYGON_MAX_VERTICES keeps its old import path and matches LIMITS', () => {
    expect(shared.POLYGON_MAX_VERTICES).toBe(shared.LIMITS.POLYGON_MAX_VERTICES);
  });
});
