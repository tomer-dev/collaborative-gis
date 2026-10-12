import { DEV } from '@cgis/shared';
import { SELF } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { db, withClient } from '../src/db';

describe('M1 composition stubs', () => {
  it('GET /api/areas is mounted but has no routes yet: 404 ApiError', async () => {
    const res = await SELF.fetch('http://x/api/areas');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ code: 'NOT_FOUND', message: 'Not found' });
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
    // wrangler.jsonc is JSON, so CLIENT_ORIGIN mirrors DEV.WEB_ORIGIN by hand; this catches drift.
    expect(env.CLIENT_ORIGIN).toBe(DEV.WEB_ORIGIN);
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
