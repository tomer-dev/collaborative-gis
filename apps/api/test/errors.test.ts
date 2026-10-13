import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { apiError } from '../src/errors';

describe('apiError', () => {
  it.each([
    ['BAD_REQUEST', 400],
    ['UNAUTHORIZED', 401],
    ['FORBIDDEN', 403],
    ['NOT_FOUND', 404],
    ['CONFLICT', 409],
    ['PAYLOAD_TOO_LARGE', 413],
    ['UNPROCESSABLE', 422],
    ['RATE_LIMITED', 429],
    ['INTERNAL', 500],
    ['NOT_READY', 503],
    ['TIMEOUT', 504],
    ['NOT_IMPLEMENTED', 501],
    ['UPGRADE_REQUIRED', 426],
  ] as const)('%s responds with status %i', async (code, status) => {
    const res = await new Hono().get('/', (c) => apiError(c, code)).request('/');
    expect(res.status).toBe(status);
    expect(await res.json()).toMatchObject({ code, message: expect.any(String) });
  });

  it('default messages come from ERROR_MESSAGES in @cgis/shared', async () => {
    const res = await new Hono().get('/', (c) => apiError(c, 'UNAUTHORIZED')).request('/');
    expect(await res.json()).toEqual({ code: 'UNAUTHORIZED', message: 'sign in' });
  });

  it('passes a custom message and details through', async () => {
    const res = await new Hono()
      .get('/', (c) => apiError(c, 'BAD_REQUEST', 'bbox is required', { field: 'bbox' }))
      .request('/');
    expect(await res.json()).toEqual({
      code: 'BAD_REQUEST',
      message: 'bbox is required',
      details: { field: 'bbox' },
    });
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
  app.get('/slow-down', () => {
    throw new HTTPException(429, { message: 'slow down' });
  });
  app.get('/teapot', () => {
    throw new HTTPException(418, { message: 'short and stout' });
  });

  it('an HTTPException keeps its status and message as an ApiError', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await app.request('http://x/unauthorized');
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ code: 'UNAUTHORIZED', message: 'nope' });
    expect(log).not.toHaveBeenCalled();
  });

  it('the code comes from the status table, else HTTP_<status>', async () => {
    const limited = await app.request('http://x/slow-down');
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ code: 'RATE_LIMITED', message: 'slow down' });
    const teapot = await app.request('http://x/teapot');
    expect(teapot.status).toBe(418);
    expect(await teapot.json()).toEqual({ code: 'HTTP_418', message: 'short and stout' });
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
