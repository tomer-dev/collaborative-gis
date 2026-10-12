import { ERROR_CODES, ROUTES } from '@cgis/shared';
import { Hono } from 'hono';
import type { AppEnv, Env } from '../app';
import { withClient } from '../db';
import { apiError } from '../errors';
import { log, requestFields } from '../log';

export const health = new Hono<AppEnv>();

health.get(ROUTES.HEALTHZ, (c) => c.json({ ok: true }));

health.get(ROUTES.READYZ, async (c) => {
  try {
    await checkDatabase(c.env);
    return c.json({ ok: true, db: 'up' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log('error', msg, requestFields(c));
    return apiError(c, ERROR_CODES.NOT_READY);
  }
});

/** Bounded by `withClient`'s connect deadline and query timeout, so a dead database is a fast 503. */
export async function checkDatabase(env: Env): Promise<void> {
  await withClient(env, (client) => client.query('select postgis_version()'));
}
