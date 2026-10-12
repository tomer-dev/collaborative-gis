import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import {
  badRequestError,
  codeFor,
  conflictError,
  forbiddenError,
  internalError,
  notFoundError,
  notReadyError,
  payloadTooLargeError,
  rateLimitedError,
  timeoutError,
  unauthorizedError,
  unprocessableError,
} from '../src/errors';

describe('error helpers', () => {
  it.each([
    ['BAD_REQUEST', 400, badRequestError],
    ['UNAUTHORIZED', 401, unauthorizedError],
    ['FORBIDDEN', 403, forbiddenError],
    ['NOT_FOUND', 404, notFoundError],
    ['CONFLICT', 409, conflictError],
    ['PAYLOAD_TOO_LARGE', 413, payloadTooLargeError],
    ['UNPROCESSABLE', 422, unprocessableError],
    ['RATE_LIMITED', 429, rateLimitedError],
    ['INTERNAL', 500, internalError],
    ['NOT_READY', 503, notReadyError],
    ['TIMEOUT', 504, timeoutError],
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

  it('codeFor reads the same table and falls back to HTTP_<status>', () => {
    expect(codeFor(401)).toBe('UNAUTHORIZED');
    expect(codeFor(429)).toBe('RATE_LIMITED');
    expect(codeFor(504)).toBe('TIMEOUT');
    expect(codeFor(418)).toBe('HTTP_418');
  });
});

describe('onError', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const app = createApp();
  app.get('/unauthorized', () => {
    throw new HTTPException(401, { message: 'nope' });
  });
  app.get('/boom', () => {
    throw new Error('boom');
  });

  it('an HTTPException keeps its status and message as an ApiError', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await app.request('http://x/unauthorized');
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ code: 'UNAUTHORIZED', message: 'nope' });
    expect(log).not.toHaveBeenCalled();
  });

  it('any other error is the fixed 500 ApiError, logged once with its stack', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await app.request('http://x/boom');
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ code: 'INTERNAL', message: 'Internal Server Error' });
    expect(log).toHaveBeenCalledOnce();
    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({
      level: 'error',
      msg: 'boom',
      path: '/boom',
      stack: expect.stringContaining('boom'),
    });
  });
});
