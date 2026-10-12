import { ERROR_MESSAGES, LIMITS, RATE_LIMIT, type RateLimitAction } from '@cgis/shared';
import type { MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { every } from 'hono/combine';
import type { AppEnv } from '../app';
import { payloadTooLargeError, rateLimitedError, unauthorizedError } from '../errors';
import { requireUser, type SignedIn } from './require-user';

const MS_PER_SECOND = 1000;

/**
 * The one guard every mutation route mounts (create, update, delete, revert), before validation:
 * `areas.post('/', describeRoute(...), mutationGuards(), validate('json', ...), handler)`.
 * In order, each answering by itself and stopping the chain:
 * 1. `requireUser()`: no session → 401, and the user's budget is never touched.
 * 2. `rateLimit(RATE_LIMIT.ACTIONS.DRAW)`: spends one action of the per-user budget the WS drawing
 *    actions share (D5) → 429 when it is spent, so rejected attempts (413, 422) count too.
 * 3. `bodyLimit`: a body over `LIMITS.BODY_MAX_BYTES` → 413 `PAYLOAD_TOO_LARGE`, before anything
 *    parses it (by `Content-Length`, else while reading the stream).
 */
export function mutationGuards(): MiddlewareHandler<AppEnv & SignedIn> {
  return every(
    requireUser(),
    rateLimit(RATE_LIMIT.ACTIONS.DRAW),
    bodyLimit({ maxSize: LIMITS.BODY_MAX_BYTES, onError: (c) => payloadTooLargeError(c) }),
  );
}

/**
 * Spends one action from the signed-in user's `RateLimiter` budget (D5) before the handler runs.
 * Mutation routes mount it through `mutationGuards()`, after the session guard.
 *
 * Over budget: 429 `{ code: 'RATE_LIMITED', message, details: { retryAfterMs } }` with
 * `Retry-After` in whole seconds, rounded up. No `user`: 401. A limiter failure propagates to
 * `onError` (500), so the request fails closed.
 */
export function rateLimit(action: RateLimitAction): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const user = c.get('user');
    if (!user) return unauthorizedError(c);

    const limiter = c.env.RATE_LIMITER.get(c.env.RATE_LIMITER.idFromName(user.id));
    const result = await limiter.take(action);
    if (!result.ok) {
      const { retryAfterMs } = result;
      c.header('Retry-After', String(Math.ceil(retryAfterMs / MS_PER_SECOND)));
      return rateLimitedError(c, ERROR_MESSAGES.RATE_LIMITED, { retryAfterMs });
    }
    await next();
  };
}
