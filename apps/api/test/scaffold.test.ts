import { DEV, ROOM } from '@cgis/shared';
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

  it('GET /api/auth/* answers 501 until Better Auth lands', async () => {
    const res = await SELF.fetch('http://x/api/auth/ok');
    expect(res.status).toBe(501);
    expect(await res.json()).toEqual({ code: 'NOT_IMPLEMENTED', message: 'not implemented' });
  });

  it('GET /ws answers 501 until the Room upgrade lands', async () => {
    const res = await SELF.fetch('http://x/ws');
    expect(res.status).toBe(501);
    expect(await res.json()).toEqual({ code: 'NOT_IMPLEMENTED', message: 'not implemented' });
  });

  it('health routes still answer through the middleware chain', async () => {
    expect((await SELF.fetch('http://x/healthz')).status).toBe(200);
    const ready = await SELF.fetch('http://x/readyz');
    expect(ready.status).toBe(200);
    expect(await ready.json()).toEqual({ ok: true, db: 'up' });
  });

  it('the test env carries the vars and secrets lanes rely on', () => {
    expect(env.DEBUG_STUB_AUTH).toBe('1');
    // wrangler.jsonc is JSON, so CLIENT_ORIGIN mirrors DEV.WEB_ORIGIN by hand; this catches drift.
    expect(env.CLIENT_ORIGIN).toBe(DEV.WEB_ORIGIN);
    expect(env.BETTER_AUTH_URL).toBe(DEV.API_ORIGIN);
    expect(env.BETTER_AUTH_SECRET.length).toBeGreaterThanOrEqual(32);
  });

  it('the ROOM binding reaches the Room Durable Object stub', async () => {
    const res = await env.ROOM.get(env.ROOM.idFromName(ROOM.DEFAULT_ROOM_ID)).fetch('http://room/');
    expect(res.status).toBe(501);
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
