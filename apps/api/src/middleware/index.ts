import type { MiddlewareHandler } from 'hono';
import { every } from 'hono/combine';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import type { AppEnv } from '../app';
import { attachUser } from './attach-user';
import { requestId } from './request-id';
import { requestTimeout } from './request-timeout';

export { attachUser } from './attach-user';
export { log, type LogLevel } from './logger';
export { mutationGuards } from './rate-limit';
export { requireUser, type SignedIn } from './require-user';

/**
 * The cross-cutting chain `app.ts` mounts on every route, outermost first:
 * - `requestId()`: `c.get('requestId')` and the `x-request-id` response header, always a fresh
 *   server-generated UUID (an incoming `x-request-id` is ignored).
 * - `cors()`: allows `env.CLIENT_ORIGIN` only, with credentials; never a wildcard.
 * - `secureHeaders()`: Hono's defaults (nosniff, HSTS, frame and referrer policies, ...).
 * - `requestTimeout()`: past `TIMEOUTS.REQUEST_MS` it aborts the request's signal, which ends its
 *   open database clients, and throws `HTTPException(504)`, which `app.onError` turns into the
 *   ApiError `{ code: 'TIMEOUT', message: 'timeout' }`.
 * - `attachUser()`: `c.get('user')` from the session cookie, else unset; never answers by itself.
 *   Last, so a preflight never reaches it, the lookup counts against the request budget, and an
 *   error it throws (database down) still leaves with the CORS and request-id headers.
 */
export function middleware(): MiddlewareHandler<AppEnv> {
  return every(
    requestId(),
    cors({
      origin: (origin, c) => (origin && origin === c.env.CLIENT_ORIGIN ? origin : null),
      credentials: true,
    }),
    secureHeaders(),
    requestTimeout(),
    attachUser(),
  );
}
