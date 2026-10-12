import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../app';
import { readSession } from '../auth';
import { SWITCHING_PROTOCOLS } from '../do/frames';

/**
 * Resolves the Better Auth session from the Cookie header and sets `c.get('user')` when there is
 * one. Never answers by itself: an anonymous request goes on with `user` unset, and routes that
 * need a user add `requireUser()`. Without the session cookie the database is not touched.
 * Cookies Better Auth set while checking (a refreshed cookie cache, D24) go out on the response,
 * except on a WebSocket 101, whose headers come from the Room and are immutable.
 */
export function attachUser(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const { user, setCookie } = await readSession(c.env, c.req.raw.headers);
    if (user) c.set('user', user);
    await next();
    if (c.res.status === SWITCHING_PROTOCOLS) return;
    for (const cookie of setCookie) c.res.headers.append('set-cookie', cookie);
  };
}
