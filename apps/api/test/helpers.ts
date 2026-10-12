import { Hono } from 'hono';
import { type AppEnv, createApp } from '../src/app';

type User = NonNullable<AppEnv['Variables']['user']>;

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
