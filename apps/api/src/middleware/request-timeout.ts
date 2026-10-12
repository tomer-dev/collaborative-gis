import { TIMEOUTS } from '@cgis/shared';
import type { MiddlewareHandler } from 'hono';
import { timeout } from 'hono/timeout';
import { withSignal } from '../db';
import { timeoutException } from '../errors';

/**
 * Hono's `timeout()` with an AbortSignal for the request's database work. Past `ms` it aborts the
 * signal, which ends every `withClient` client still open in this request (`withSignal` makes it
 * their default), and throws the 504 `timeoutException` that `app.onError` answers as `TIMEOUT`.
 * The signal also follows `c.req.raw.signal`, which fires on a client disconnect only with the
 * `enable_request_signal` compatibility flag.
 *
 * Wall time only: CPU time is the platform's own per-request limit (Workers Paid: 30 s by default,
 * `limits.cpu_ms` in wrangler.jsonc raises it; Free: 10 ms), and HTTP wall time has no platform
 * limit, which is why this budget exists.
 */
export function requestTimeout(ms: number = TIMEOUTS.REQUEST_MS): MiddlewareHandler {
  return (c, next) => {
    const deadline = new AbortController();
    const expired = () => {
      const exception = timeoutException();
      deadline.abort(exception);
      return exception;
    };
    const signal = AbortSignal.any([deadline.signal, c.req.raw.signal]);
    return withSignal(signal, () => timeout(ms, expired)(c, next));
  };
}
