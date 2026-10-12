import { type AuthUser as User, RATE_LIMIT } from '@cgis/shared';
import { env } from 'cloudflare:workers';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppEnv } from '../../src/app';
import { rateLimit } from '../../src/middleware/rate-limit';

const { DRAW_ACTIONS_PER_WINDOW: LIMIT, WINDOW_MS, ACTIONS } = RATE_LIMIT;
// Far ahead of the real clock: workerd schedules alarms on real time, so an alarm armed at a
// mocked instant in the past would fire mid-test (see rate-limiter.test.ts).
const T0 = Date.UTC(2100, 0, 1);

const freshUser = (): User => ({ id: `user-${crypto.randomUUID()}`, name: 'Test User' });

/** A mutation route behind `rateLimit`, with `user` set the way the session guard will set it. */
function appFor(user?: User) {
  const handler = vi.fn(() => new Response(null, { status: 201 }));
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    if (user) c.set('user', user);
    await next();
  });
  app.post('/areas', rateLimit(ACTIONS.MUTATE), handler);
  const post = () => app.request('http://x/areas', { method: 'POST' }, env);
  return { post, handler };
}

beforeEach(() => {
  vi.setSystemTime(T0);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('rateLimit middleware', () => {
  it('answers 401 without a user and never reaches the handler', async () => {
    const { post, handler } = appFor();
    const res = await post();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ code: 'UNAUTHORIZED', message: 'sign in' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('lets DRAW_ACTIONS_PER_WINDOW requests through, then answers 429 with Retry-After', async () => {
    const { post, handler } = appFor(freshUser());
    for (let i = 0; i < LIMIT; i++) expect((await post()).status).toBe(201);
    expect(handler).toHaveBeenCalledTimes(LIMIT);

    const res = await post();
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe(String(WINDOW_MS / 1000));
    expect(await res.json()).toEqual({
      code: 'RATE_LIMITED',
      message: 'Too many requests',
      details: { retryAfterMs: WINDOW_MS },
    });
    expect(handler).toHaveBeenCalledTimes(LIMIT);
  });

  it('rounds Retry-After up to whole seconds', async () => {
    const { post } = appFor(freshUser());
    for (let i = 0; i < LIMIT; i++) await post();

    vi.setSystemTime(T0 + 20_500);
    const res = await post();
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('40');
    expect(await res.json()).toMatchObject({ details: { retryAfterMs: 39_500 } });
  });

  it('shares one budget with direct take() calls (the Room DO path)', async () => {
    const user = freshUser();
    const limiter = env.RATE_LIMITER.get(env.RATE_LIMITER.idFromName(user.id));
    for (let i = 0; i < LIMIT; i++) await limiter.take(ACTIONS.DRAW);

    const { post, handler } = appFor(user);
    expect((await post()).status).toBe(429);
    expect(handler).not.toHaveBeenCalled();
  });

  it('keeps budgets per user', async () => {
    const alice = appFor(freshUser());
    const bob = appFor(freshUser());
    for (let i = 0; i < LIMIT; i++) await alice.post();

    expect((await alice.post()).status).toBe(429);
    expect((await bob.post()).status).toBe(201);
  });
});
