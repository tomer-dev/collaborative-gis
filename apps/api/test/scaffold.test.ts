import { DEV } from '@cgis/shared';
import { SELF } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { db, withClient } from '../src/db';

describe('M1 composition stubs', () => {
  it('GET /api/areas reaches the area routes (M1 T15): 401 without a session', async () => {
    const res = await SELF.fetch('http://x/api/areas');
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ code: 'UNAUTHORIZED', message: 'sign in' });
  });

  it('GET /api/auth/* reaches Better Auth (M1 T4)', async () => {
    const res = await SELF.fetch('http://x/api/auth/ok');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('health routes still answer through the middleware chain', async () => {
    expect((await SELF.fetch('http://x/healthz')).status).toBe(200);
    const ready = await SELF.fetch('http://x/readyz');
    expect(ready.status).toBe(200);
    expect(await ready.json()).toEqual({ ok: true, db: 'up' });
  });

  it('the test env carries the vars and secrets lanes rely on', () => {
    expect(env.BETTER_AUTH_URL).toBe(DEV.API_ORIGIN);
    expect(env.BETTER_AUTH_SECRET.length).toBeGreaterThanOrEqual(32);
  });

  it('withClient + db run a Drizzle query on one per-call client', async () => {
    const rows = await withClient(env, async (client) => {
      const result = await db(client).execute<{ one: number }>(sql`select 1 as one`);
      return result.rows;
    });
    expect(rows).toEqual([{ one: 1 }]);
  });

  it('withClient rejects with the callback error', async () => {
    await expect(
      withClient(env, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
  });
});
