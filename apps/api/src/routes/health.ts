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
    const message = err instanceof Error ? err.message : String(err);
    return c.json<ApiError>({ code: 'NOT_READY', message }, 503);
  }
});

// ponytail: real query lands in Task 5 once HYPERDRIVE exists; until then the probe fails closed.
export async function checkDatabase(env: Env): Promise<void> {
  if (!env.HYPERDRIVE) throw new Error('HYPERDRIVE binding is not configured');
  const { Client } = await import('pg');
  const client = new Client({ connectionString: env.HYPERDRIVE.connectionString });
  await client.connect();
  try {
    await client.query('select 1');
  } finally {
    await client.end();
  }
}
