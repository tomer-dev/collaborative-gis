import { describe, expect, it } from 'vitest';
import { ApiErrorCodeSchema } from './api';

describe('ApiErrorCodeSchema', () => {
  it('lists the codes the API sends and rejects others', () => {
    expect(ApiErrorCodeSchema.options).toEqual([
      'BAD_REQUEST',
      'UNAUTHORIZED',
      'FORBIDDEN',
      'NOT_FOUND',
      'CONFLICT',
      'UNPROCESSABLE',
      'PAYLOAD_TOO_LARGE',
      'RATE_LIMITED',
      'TIMEOUT',
      'NOT_READY',
      'INTERNAL',
      'NOT_IMPLEMENTED',
      'UPGRADE_REQUIRED',
      'DRAFT_OP_MISFIT',
    ]);
    expect(ApiErrorCodeSchema.safeParse('NOPE').success).toBe(false);
  });
});
