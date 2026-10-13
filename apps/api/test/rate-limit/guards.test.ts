import { AreaSchema, LIMITS, RATE_LIMIT, ROUTES, type Polygon } from '@cgis/shared';
import { createExecutionContext } from 'cloudflare:test';
import { env as workerEnv } from 'cloudflare:workers';
import { Hono } from 'hono';
import pg from 'pg';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppEnv, Env } from '../../src/app';
import { mutationGuards } from '../../src/middleware/rate-limit';
import {
  areasClient,
  areasEnv,
  countRows,
  freshUser,
  openRingAt,
  randomSpot,
  squareAt,
} from '../areas/fixtures';
import { appWithUser, type User } from '../helpers';

const { DRAW_ACTIONS_PER_WINDOW: LIMIT, WINDOW_MS, ACTIONS } = RATE_LIMIT;
// Far ahead of the real clock: workerd schedules alarms on real time, so an alarm armed at a
// mocked instant in the past would fire mid-test (see rate-limiter.test.ts).
const T0 = Date.UTC(2100, 0, 1);
const KIB = 1024;
/** Whole seconds, at least 1: what `Retry-After` must carry. */
const WHOLE_SECONDS = /^[1-9]\d*$/;

let env: Env;
beforeAll(async () => {
  env = await areasEnv();
});
beforeEach(() => {
  vi.setSystemTime(T0);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** A `RATE_LIMITER` stand-in that refuses every action and counts the calls that reach it. */
function refusingLimiter(retryAfterMs: number) {
  const calls = { take: 0 };
  const binding = {
    idFromName: (name: string) => name,
    get: () => ({
      take: async () => {
        calls.take++;
        return { ok: false, retryAfterMs };
      },
    }),
  };
  return { calls, binding };
}

/** One route behind `mutationGuards()`, then the validation a real mutation route runs next. */
function guardedApp(user?: User) {
  const handler = vi.fn();
  const app = new Hono<AppEnv>()
    .use('*', async (c, next) => {
      if (user) c.set('user', user);
      await next();
    })
    .post('/m', mutationGuards(), async (c) => {
      // Stands in for `validate('json', ...)`: a body that is not JSON would be a 422.
      await c.req.json();
      handler();
      return c.json({}, 201);
    });
  return { app, handler };
}

const oversized = () => JSON.stringify({ name: 'x'.repeat(65 * KIB), geometry: null });

describe('mutationGuards(): budget, then body size', () => {
  it('a signed-in request over budget is 429 with Retry-After in whole seconds, even with an oversized body', async () => {
    const limiter = refusingLimiter(1_500);
    const { app, handler } = guardedApp(freshUser());
    const res = await app.request(
      'http://x/m',
      { method: 'POST', body: oversized() },
      { ...workerEnv, RATE_LIMITER: limiter.binding },
    );

    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('2');
    expect(await res.json()).toEqual({
      code: 'RATE_LIMITED',
      message: 'Too many requests',
      details: { retryAfterMs: 1_500 },
    });
    expect(limiter.calls.take).toBe(1);
    expect(handler).not.toHaveBeenCalled();
  });

  it('a body over LIMITS.BODY_MAX_BYTES is 413 PAYLOAD_TOO_LARGE before the handler parses it', async () => {
    const { app, handler } = guardedApp(freshUser());
    const res = await app.request('http://x/m', { method: 'POST', body: oversized() }, workerEnv);

    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ code: 'PAYLOAD_TOO_LARGE', message: 'Payload too large' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('a body at LIMITS.BODY_MAX_BYTES reaches the handler', async () => {
    const { app, handler } = guardedApp(freshUser());
    const padding = LIMITS.BODY_MAX_BYTES - JSON.stringify({ name: '' }).length;
    const body = JSON.stringify({ name: 'x'.repeat(padding) });
    expect(body.length).toBe(LIMITS.BODY_MAX_BYTES);

    const res = await app.request('http://x/m', { method: 'POST', body }, workerEnv);
    expect(res.status).toBe(201);
    expect(handler).toHaveBeenCalledOnce();
  });
});

describe('the area mutation routes mount mutationGuards()', () => {
  it('the 51st mutation in the window is 429 with an integer Retry-After >= 1; after the window refills the next one is 201', async () => {
    const user = freshUser();
    const api = areasClient(env, user);
    const spot = randomSpot();

    // Rejected attempts spend the budget too: these 422 without touching the database.
    for (let i = 0; i < LIMIT; i++) {
      expect((await api.create({ name: 'x', geometry: openRingAt(spot) })).status).toBe(422);
    }

    const refused = await api.create({ name: 'over budget', geometry: squareAt(spot) });
    expect(refused.status).toBe(429);
    const retryAfter = refused.headers.get('Retry-After') ?? '';
    expect(retryAfter).toMatch(WHOLE_SECONDS);
    expect(Number(retryAfter)).toBeLessThanOrEqual(WINDOW_MS / 1000);
    expect(await countRows(env, 'areas', 'created_by = $1', [user.id])).toBe(0);

    vi.setSystemTime(T0 + WINDOW_MS);
    const accepted = await api.create({ name: 'refilled', geometry: squareAt(spot) });
    expect(accepted.status).toBe(201);
    expect(AreaSchema.parse(await accepted.json()).createdBy).toBe(user.id);
  }, 30_000);

  it('REST shares the WS budget: DRAW_ACTIONS_PER_WINDOW draw actions on the RateLimiter stub the Room DO calls, then a REST create is 429', async () => {
    // The Room DO spends WS drawing actions as `take(ACTIONS.DRAW)` on this same stub (keyed by
    // the user id); the frame-level path (`draft:update` over a socket) lands with the WS lane.
    const user = freshUser();
    const limiter = env.RATE_LIMITER.get(env.RATE_LIMITER.idFromName(user.id));
    for (let i = 0; i < LIMIT; i++) expect((await limiter.take(ACTIONS.DRAW)).ok).toBe(true);

    const res = await areasClient(env, user).create({
      name: 'x',
      geometry: squareAt(randomSpot()),
    });
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toMatch(WHOLE_SECONDS);
    expect(await countRows(env, 'areas', 'created_by = $1', [user.id])).toBe(0);
  });

  it('a 65 KiB body is 413 on POST, PUT and revert before any database call', async () => {
    const connect = vi.spyOn(pg.Client.prototype, 'connect');
    const user = freshUser();
    const api = areasClient(env, user);
    const body = { name: 'x'.repeat(65 * KIB), geometry: squareAt(randomSpot()) };
    // The revert route takes no body, so its client sends none; one sent anyway is capped too.
    const revert = () =>
      appWithUser(user).request(
        `${ROUTES.AREAS}/${crypto.randomUUID()}/revert/1`,
        { method: 'POST', body: JSON.stringify(body) },
        env,
        createExecutionContext(),
      );

    const responses = [
      await api.create(body),
      await api.update(crypto.randomUUID(), body),
      await revert(),
    ];
    for (const res of responses) {
      expect(res.status).toBe(413);
      expect(await res.json()).toEqual({ code: 'PAYLOAD_TOO_LARGE', message: 'Payload too large' });
    }
    expect(connect).not.toHaveBeenCalled();
  });

  it('a polygon at POLYGON_MAX_VERTICES with full-precision coordinates fits under the cap (201)', async () => {
    const geometry = fullPrecisionRing(LIMITS.POLYGON_MAX_VERTICES);
    const body = { name: 'n'.repeat(LIMITS.AREA_NAME_MAX), geometry };
    expect(JSON.stringify(body).length).toBeLessThan(LIMITS.BODY_MAX_BYTES);

    const res = await areasClient(env, freshUser()).create(body);
    expect(res.status).toBe(201);
  });
});

/**
 * A closed ring of `positions` (closing vertex included) on a small circle near (-179.5, -80.5),
 * where coordinates print longest (sign, three integer digits, ~14 decimals).
 */
function fullPrecisionRing(positions: number): Polygon {
  const placed = positions - 1;
  const ring = Array.from({ length: placed }, (_, i): [number, number] => {
    const angle = (2 * Math.PI * i) / placed;
    return [-179.5 + 0.01 * Math.cos(angle) + 1e-13, -80.5 + 0.01 * Math.sin(angle) + 1e-13];
  });
  return { type: 'Polygon', coordinates: [[...ring, ring[0]!]] };
}
