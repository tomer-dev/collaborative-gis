import { ERROR_MESSAGES } from '@cgis/shared';
import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../app';
import { rateLimitedError, unauthorizedError } from '../errors';

const MS_PER_SECOND = 1000;

/**
 * Spends one action from the signed-in user's `RateLimiter` budget (D5) before the handler runs.
 * Mount it after the session guard on each mutation: `areas.post('/', rateLimit('draw'), handler)`.
 *
 * Over budget: 429 `{ code: 'RATE_LIMITED', message, details: { retryAfterMs } }` with
 * `Retry-After` in whole seconds, rounded up. No `user`: 401. A limiter failure propagates to
 * `onError` (500), so the request fails closed.
 */
export function rateLimit(action: string): MiddlewareHandler<AppEnv> {
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
