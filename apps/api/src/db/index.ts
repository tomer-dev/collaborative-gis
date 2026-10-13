import { TIMEOUTS } from '@cgis/shared';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import type { Env } from '../app';
import { log } from '../log';
import * as schema from './schema';

/**
 * Runs `fn` with a fresh `pg.Client` on `env.HYPERDRIVE` and closes it afterwards.
 * One client per call: Hyperdrive pools the connections, so nothing session-scoped is kept here.
 * Bounded: connecting by a hard `TIMEOUTS.DB_CONNECT_MS` deadline, each query by `DB_QUERY_MS`.
 */
export async function withClient<T>(env: Env, fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({
    connectionString: env.HYPERDRIVE.connectionString,
    connectionTimeoutMillis: TIMEOUTS.DB_CONNECT_MS,
    query_timeout: TIMEOUTS.DB_QUERY_MS,
  });
  // Errors during connect()/query() reject those calls, so they are not logged here. workerd
  // emits a benign 'socket closed' error after end(); anything else (e.g. a drop mid-session)
  // would otherwise vanish, so it is logged.
  client.on('error', (err) => {
    if (/socket.*closed/i.test(err.message)) return;
    log('error', err.message, { src: 'pg' });
  });

  try {
    // pg's connect timeout cannot interrupt a TCP connect workerd is still opening, so the
    // connect also races a hard deadline.
    await withDeadline(client.connect(), TIMEOUTS.DB_CONNECT_MS, 'database connect');
  } catch (err) {
    // end() waits for a connect still in flight (workerd's socket.close() does), so close in the
    // background instead of holding the request.
    client.end().catch(() => {});
    throw err;
  }
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** Drizzle over a client from `withClient`. */
export function db(client: pg.Client) {
  return drizzle(client, { schema });
}

async function withDeadline<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} exceeded ${ms} ms`)), ms);
  });
  try {
    return await Promise.race([promise, deadline]);
  } finally {
    clearTimeout(timer);
  }
}
