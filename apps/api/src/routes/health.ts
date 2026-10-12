import { Hono } from 'hono';
import type { Env } from '../app';
import { notReadyError } from '../errors';

export const health = new Hono<{ Bindings: Env }>();

health.get('/healthz', (c) => c.json({ ok: true }));

health.get('/readyz', async (c) => {
  try {
    await checkDatabase(c.env);
    return c.json({ ok: true, db: 'up' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(JSON.stringify({ level: 'error', msg, path: c.req.path }));
    return notReadyError(c, 'database unreachable');
  }
});

/** /readyz answers within this budget, so a stalled or unroutable database means a fast 503. */
const READY_TIMEOUT_MS = 3000;

// ponytail: one Client per call is enough for a probe; the M1 db lane extracts `withClient`
// into src/db/client.ts when Drizzle lands.
export async function checkDatabase(env: Env): Promise<void> {
  const { Client } = await import('pg');
  const client = new Client({
    connectionString: env.HYPERDRIVE.connectionString,
    connectionTimeoutMillis: READY_TIMEOUT_MS,
    query_timeout: READY_TIMEOUT_MS,
  });
  // Errors during connect()/query() reject those calls, so they are not logged here. workerd
  // emits a benign 'socket closed' error after end(); anything else (e.g. a drop mid-session)
  // would otherwise vanish, so it is logged.
  client.on('error', (err) => {
    if (/socket.*closed/i.test(err.message)) return;
    console.error(JSON.stringify({ level: 'error', msg: err.message, src: 'pg' }));
  });
  const probe = (async () => {
    try {
      await client.connect();
      await client.query('select postgis_version()');
    } finally {
      await client.end();
    }
  })();
  // pg's connect timeout cannot interrupt a TCP connect workerd is still opening (its
  // socket.close() waits for the connect), so the probe also races a hard deadline.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`database check exceeded ${READY_TIMEOUT_MS} ms`)),
      READY_TIMEOUT_MS,
    );
  });
  try {
    await Promise.race([probe, deadline]);
  } finally {
    clearTimeout(timer);
  }
}
