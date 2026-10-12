import { AsyncLocalStorage } from 'node:async_hooks';
import { TIMEOUTS } from '@cgis/shared';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import type { Env } from '../app';
import { timeoutException } from '../errors';
import { log } from '../log';
import * as schema from './schema';

/** pg rejects a query that outlived `query_timeout` with this message (pg/lib/client.js). */
const PG_QUERY_TIMEOUT = 'Query read timeout';

const requestSignal = new AsyncLocalStorage<AbortSignal>();

/**
 * Runs `fn` with `signal` as the default `withClient` signal for every database call made inside
 * it. The request timeout middleware wraps each request in it, so routes, services and auth need
 * no signal parameter for a timed-out request to end its clients.
 */
export function withSignal<T>(signal: AbortSignal, fn: () => T): T {
  return requestSignal.run(signal, fn);
}

export type ClientOptions = {
  /**
   * When it aborts, the client is ended at once (the query in flight rejects) and the call rejects
   * with the signal's reason. Default: the signal of the request being served (`withSignal`).
   */
  signal?: AbortSignal;
};

/**
 * Runs `fn` with a fresh `pg.Client` on `env.HYPERDRIVE` and closes it afterwards.
 * One client per call: Hyperdrive pools the connections, so nothing session-scoped is kept here.
 * Bounded: connecting by a hard `TIMEOUTS.DB_CONNECT_MS` deadline; each query by `DB_QUERY_MS`,
 * past which it rejects with the 504 `timeoutException`; the whole call by `signal`.
 */
export async function withClient<T>(
  env: Env,
  fn: (client: pg.Client) => Promise<T>,
  { signal = requestSignal.getStore() }: ClientOptions = {},
): Promise<T> {
  signal?.throwIfAborted();
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

  // In the background: end() waits for a connect still in flight (workerd's socket.close() does),
  // and with a query in flight pg destroys the socket, which rejects that query now.
  const endNow = () => void client.end().catch(() => {});
  signal?.addEventListener('abort', endNow, { once: true });
  try {
    try {
      // pg's connect timeout cannot interrupt a TCP connect workerd is still opening, so the
      // connect also races a hard deadline.
      await withDeadline(client.connect(), TIMEOUTS.DB_CONNECT_MS, 'database connect');
    } catch (err) {
      endNow();
      signal?.throwIfAborted();
      throw err;
    }
    try {
      // Aborted while connecting: the client is already ending.
      signal?.throwIfAborted();
      return await fn(client);
    } catch (err) {
      // After an abort, pg's 'Connection terminated' only echoes it: reject with the reason.
      signal?.throwIfAborted();
      throw err instanceof Error && err.message === PG_QUERY_TIMEOUT ? timeoutException(err) : err;
    } finally {
      await client.end();
    }
  } finally {
    signal?.removeEventListener('abort', endNow);
  }
}

/** Drizzle over a client from `withClient`. */
export function db(client: pg.Client) {
  return drizzle(client, { schema });
}

/** `promise`, or a rejection `<what> exceeded <ms> ms` once `ms` pass first. */
export async function withDeadline<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
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
