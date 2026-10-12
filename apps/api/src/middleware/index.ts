import { ERROR_MESSAGES, ROUTES, TIMEOUTS } from '@cgis/shared';
import type { MiddlewareHandler } from 'hono';
import { every, except } from 'hono/combine';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import { requestId } from 'hono/request-id';
import { secureHeaders } from 'hono/secure-headers';
import { timeout } from 'hono/timeout';
import type { AppEnv } from '../app';
import { attachUser } from './attach-user';

export { attachUser } from './attach-user';
export { requireUser, type SignedIn } from './require-user';

/**
 * The cross-cutting chain `app.ts` mounts on every route, outermost first:
 * - `requestId({ limitLength: 0 })` (Hono's): `c.get('requestId')` and the `x-request-id` response
 *   header. With a limit of 0 every incoming `x-request-id` is too long, so the id is always a
 *   fresh server-generated UUID: a client cannot choose the id its requests are logged under.
 * - `cors()`: allows `env.CLIENT_ORIGIN` only, with credentials; never a wildcard.
 * - `secureHeaders()`: Hono's defaults (nosniff, HSTS, frame and referrer policies, ...).
 * - `timeout()`: past `TIMEOUTS.REQUEST_MS` it throws `HTTPException(504)`, which `app.onError`
 *   turns into the ApiError `{ code: 'TIMEOUT', message: 'timeout' }`.
 * - `attachUser()`: `c.get('user')` from the session cookie, else unset; never answers by itself.
 *   Last, so a preflight never reaches it, the lookup counts against the request budget, and an
 *   error it throws (database down) still leaves with the CORS and request-id headers. Skipped on
 *   `/api/auth/*` (Better Auth reads its own session) and on the health paths, so `/readyz`
 *   reports a database outage as 503 whatever cookies the caller sends.
 */
export function middleware(): MiddlewareHandler<AppEnv> {
  return every(
    requestId({ limitLength: 0 }),
    cors({
      origin: (origin, c) => (origin && origin === c.env.CLIENT_ORIGIN ? origin : null),
      credentials: true,
    }),
    secureHeaders(),
    timeout(TIMEOUTS.REQUEST_MS, () => new HTTPException(504, { message: ERROR_MESSAGES.TIMEOUT })),
    except([`${ROUTES.AUTH}/*`, ROUTES.HEALTHZ, ROUTES.READYZ], attachUser()),
  );
}
