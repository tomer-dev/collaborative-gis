import type { ApiError } from '@cgis/shared';
import { Hono } from 'hono';
import type { Env } from '../app';

export const health = new Hono<{ Bindings: Env }>();

health.get('/healthz', (c) => c.json({ ok: true }));

health.get('/readyz', async (c) => {
  try {
    await checkDatabase(c.env);
    return c.json({ ok: true, db: 'up' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(JSON.stringify({ level: 'error', msg, path: c.req.path }));
    return c.json<ApiError>({ code: 'NOT_READY', message: 'database unreachable' }, 503);
  }
});

export async function checkDatabase(env: Env): Promise<void> {
  const { Client } = await import('pg');
  const client = new Client({ connectionString: env.HYPERDRIVE.connectionString });
  // Errors reject connect()/query(); this absorbs workerd's post-end() 'socket closed' event.
  client.on('error', () => {});
  try {
    await client.connect();
    await client.query('select postgis_version()');
  } finally {
    await client.end();
  }
}
