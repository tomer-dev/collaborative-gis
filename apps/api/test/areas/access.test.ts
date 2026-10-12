import { AreaSchema, RATE_LIMIT, ROUTES } from '@cgis/shared';
import { createExecutionContext } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp, type Env } from '../../src/app';
import {
  areasClient,
  areasEnv,
  bboxAround,
  countRows,
  freshUser,
  openRingAt,
  randomSpot,
  squareAt,
} from './fixtures';
import { signUp } from '../auth/session';

let env: Env;
beforeAll(async () => {
  env = await areasEnv();
});

describe('authentication', () => {
  it('answers 401 on every area route without a session, before validation', async () => {
    const api = areasClient(env);
    const id = crypto.randomUUID();
    const spot = randomSpot();
    const responses = [
      await api.create({ name: 'x', geometry: squareAt(spot) }),
      await api.create({}),
      await api.list(`bbox=${bboxAround(spot)}`),
      await api.list(''),
      await api.update(id, { name: 'x', geometry: squareAt(spot), version: 1 }),
      await api.update('not-a-uuid', {}),
      await api.remove(id),
      await api.remove('not-a-uuid'),
    ];
    for (const res of responses) {
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ code: 'UNAUTHORIZED', message: 'sign in' });
    }
  });

  it('serves a signed-in Better Auth session end to end (cookie, no test user injection)', async () => {
    const app = createApp();
    const { user, cookie } = await signUp(env, 'Cookie User');

    const res = await app.request(
      ROUTES.AREAS,
      {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'by cookie', geometry: squareAt(randomSpot()) }),
      },
      env,
      createExecutionContext(),
    );
    expect(res.status).toBe(201);
    expect(AreaSchema.parse(await res.json()).createdBy).toBe(user.id);
  });
});

describe('rate limit (D5)', () => {
  // 50+ sequential requests through the app and the RateLimiter DO while other files run: 30 s.
  it('the mutation after DRAW_ACTIONS_PER_WINDOW inside the window is 429 with Retry-After and writes nothing', async () => {
    const user = freshUser();
    const api = areasClient(env, user);
    const spot = randomSpot();

    // Every mutation spends the budget, rejected ones included: these 422 without touching the DB.
    for (let i = 0; i < RATE_LIMIT.DRAW_ACTIONS_PER_WINDOW; i++) {
      expect((await api.create({ name: 'x', geometry: openRingAt(spot) })).status).toBe(422);
    }

    const res = await api.create({ name: 'over budget', geometry: squareAt(spot) });
    expect(res.status).toBe(429);
    const retryAfter = Number(res.headers.get('Retry-After'));
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(RATE_LIMIT.WINDOW_MS / 1000);
    expect(await res.json()).toMatchObject({ code: 'RATE_LIMITED' });
    expect(await countRows(env, 'areas', 'created_by = $1', [user.id])).toBe(0);

    // The same budget covers PUT and DELETE; reads are not limited.
    expect((await api.update(crypto.randomUUID(), {})).status).toBe(429);
    expect((await api.remove(crypto.randomUUID())).status).toBe(429);
    expect((await api.list(`bbox=${bboxAround(spot)}`)).status).toBe(200);
  }, 30_000);
});

describe('GET /openapi.json', () => {
  it('documents the four area operations, public', async () => {
    const res = await createApp().request(ROUTES.OPENAPI, {}, env);
    expect(res.status).toBe(200);
    const doc = await res.json<{
      info: { title: string; version: string };
      paths: Record<string, Record<string, unknown>>;
    }>();
    expect(doc.info).toMatchObject({ title: expect.any(String), version: expect.any(String) });
    expect(Object.keys(doc.paths['/api/areas'] ?? {}).sort()).toEqual(['get', 'post']);
    expect(Object.keys(doc.paths['/api/areas/{id}'] ?? {}).sort()).toEqual(['delete', 'put']);
  });
});
