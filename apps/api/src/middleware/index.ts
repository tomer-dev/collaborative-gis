import { ERROR_MESSAGES, TIMEOUTS } from '@cgis/shared';
import type { MiddlewareHandler } from 'hono';
import { every } from 'hono/combine';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import { requestId } from 'hono/request-id';
import { secureHeaders } from 'hono/secure-headers';
import { timeout } from 'hono/timeout';
import type { AppEnv } from '../app';

export { log, type LogLevel } from './logger';

/**
 * The cross-cutting chain `app.ts` mounts on every route, outermost first:
 * - `requestId()`: `c.get('requestId')` and the `x-request-id` response header. A well-formed
 *   incoming `x-request-id` (≤255 chars of `[A-Za-z0-9_=-]`) is kept; anything else gets a UUID.
 * - `cors()`: allows `env.CLIENT_ORIGIN` only, with credentials; never a wildcard.
 * - `secureHeaders()`: Hono's defaults (nosniff, HSTS, frame and referrer policies, ...).
 * - `timeout()`: past `TIMEOUTS.REQUEST_MS` it throws `HTTPException(504)`, which `app.onError`
 *   turns into the ApiError `{ code: 'TIMEOUT', message: 'timeout' }`.
 */
export function middleware(): MiddlewareHandler<AppEnv> {
  return every(
    requestId(),
    cors({
      origin: (origin, c) => (origin && origin === c.env.CLIENT_ORIGIN ? origin : null),
      credentials: true,
    }),
    secureHeaders(),
    timeout(TIMEOUTS.REQUEST_MS, () => new HTTPException(504, { message: ERROR_MESSAGES.TIMEOUT })),
  );
}
