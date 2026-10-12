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

// ponytail: HYPERDRIVE binding lands in Task 5; until then the probe fails closed.
export async function checkDatabase(env: Env): Promise<void> {
  if (!env.HYPERDRIVE) throw new Error('HYPERDRIVE binding is not configured');
  const { Client } = await import('pg');
  const client = new Client({ connectionString: env.HYPERDRIVE.connectionString });
  try {
    await client.connect();
    await client.query('select 1');
  } finally {
    await client.end();
  }
}
