import { ERROR_CODES } from '@cgis/shared';
import type { MiddlewareHandler } from 'hono';
import type { SessionUser } from '../auth';
import { apiError } from '../errors';

/** What `requireUser()` guarantees the handlers after it: `c.get('user')` is set. */
export type SignedIn = { Variables: { user: SessionUser } };

/**
 * Lets a request through only when `attachUser()` found a session; otherwise answers 401
 * `{ code: 'UNAUTHORIZED', message: ERROR_MESSAGES.UNAUTHORIZED }`. Its `SignedIn` env types
 * `c.get('user')` as set in the handlers composed after it (`app.get(path, requireUser(), h)`).
 */
export function requireUser(): MiddlewareHandler<SignedIn> {
  return async (c, next) => {
    // The type already describes the handlers after this guard; here the user may be missing.
    if (!c.get('user')) return apiError(c, ERROR_CODES.UNAUTHORIZED);
    await next();
  };
}
