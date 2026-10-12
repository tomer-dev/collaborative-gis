import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../app';
import { getSessionUser } from '../auth';

/**
 * Resolves the Better Auth session from the Cookie header and sets `c.get('user')` when there is
 * one. Never answers by itself: an anonymous request goes on with `user` unset, and routes that
 * need a user add `requireUser()`. Without a Cookie header the database is not touched.
 */
export function attachUser(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const user = await getSessionUser(c.env, c.req.raw.headers);
    if (user) c.set('user', user);
    await next();
  };
}
