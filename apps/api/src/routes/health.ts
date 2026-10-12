import { ROUTES } from '@cgis/shared';
import { Hono } from 'hono';
import type { AppEnv, Env } from '../app';
import { withClient } from '../db';
import { notReadyError } from '../errors';

export const health = new Hono<AppEnv>();

health.get(ROUTES.HEALTHZ, (c) => c.json({ ok: true }));

health.get(ROUTES.READYZ, async (c) => {
  try {
    await checkDatabase(c.env);
    return c.json({ ok: true, db: 'up' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(JSON.stringify({ level: 'error', msg, path: c.req.path }));
    return notReadyError(c);
  }
});

/** Bounded by `withClient`'s connect deadline and query timeout, so a dead database is a fast 503. */
export async function checkDatabase(env: Env): Promise<void> {
  await withClient(env, (client) => client.query('select postgis_version()'));
}
