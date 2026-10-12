import type { AuthUser } from '@cgis/shared';
import { Hono } from 'hono';
import { type AppEnv, createApp } from '../src/app';

/** Test-only tunables (never app config, so not in @cgis/shared). */
export const TEST = {
  /**
   * Per-test timeout for tests that make dozens of sequential requests through the app and a
   * Durable Object: Vitest's 5 s default is too tight while other files share the machine.
   */
  SLOW_TIMEOUT_MS: 15_000,
} as const;

/** A signed-in user as `c.get('user')` holds it. */
export type User = AuthUser;

/**
 * The real app with `user` already signed in: sets `c.get('user')` at the composition layer, where
 * the session middleware sets it in production. Production code has no authentication bypass.
 * Use with `app.request(path, init, env)`.
 */
export function appWithUser(user: User) {
  return new Hono<AppEnv>()
    .use('*', (c, next) => {
      c.set('user', user);
      return next();
    })
    .route('/', createApp());
}
