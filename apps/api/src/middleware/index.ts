import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../app';

/**
 * The cross-cutting chain `app.ts` mounts on every route.
 * Stub: M1 T3 (auth lane) fills it with requestId, cors, secureHeaders and timeout.
 */
export function middleware(): MiddlewareHandler<AppEnv> {
  return (_c, next) => next();
}
