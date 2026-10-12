import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import {
  badRequestError,
  conflictError,
  forbiddenError,
  internalError,
  notFoundError,
  notReadyError,
  payloadTooLargeError,
  rateLimitedError,
  unauthorizedError,
} from '../src/errors';

describe('error helpers', () => {
  it.each([
    ['BAD_REQUEST', 400, badRequestError],
    ['UNAUTHORIZED', 401, unauthorizedError],
    ['FORBIDDEN', 403, forbiddenError],
    ['NOT_FOUND', 404, notFoundError],
    ['CONFLICT', 409, conflictError],
    ['PAYLOAD_TOO_LARGE', 413, payloadTooLargeError],
    ['RATE_LIMITED', 429, rateLimitedError],
    ['INTERNAL', 500, internalError],
    ['NOT_READY', 503, notReadyError],
  ] as const)('%s responds with status %i', async (code, status, helper) => {
    const res = await new Hono().get('/', (c) => helper(c)).request('/');
    expect(res.status).toBe(status);
    expect(await res.json()).toMatchObject({ code, message: expect.any(String) });
  });

  it('passes a custom message and details through', async () => {
    const res = await new Hono()
      .get('/', (c) => badRequestError(c, 'bbox is required', { field: 'bbox' }))
      .request('/');
    expect(await res.json()).toEqual({
      code: 'BAD_REQUEST',
      message: 'bbox is required',
      details: { field: 'bbox' },
    });
  });
});
