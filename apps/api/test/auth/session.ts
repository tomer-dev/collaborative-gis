import { ROUTES } from '@cgis/shared';
import { env } from 'cloudflare:workers';
import { expect } from 'vitest';
import { createApp, type Env } from '../../src/app';

// Wire values are spelled out on purpose: they are the contract the SPA and browsers rely on.
export const SESSION_COOKIE = 'better-auth.session_token';
export const PASSWORD = 'correct horse battery staple';

type AuthInit = { method?: string; body?: unknown; headers?: HeadersInit };

/**
 * One request to Better Auth (`ROUTES.AUTH` + `path`) through the real app, middleware chain
 * included, against `testEnv`'s database; from `CLIENT_ORIGIN` unless `headers` names an origin.
 */
export function authRequest(testEnv: Env, path: string, init: AuthInit = {}) {
  const headers = new Headers(init.headers);
  if (!headers.has('origin')) headers.set('origin', env.CLIENT_ORIGIN);
  if (init.body !== undefined) headers.set('content-type', 'application/json');
  return createApp().request(
    `${env.BETTER_AUTH_URL}${ROUTES.AUTH}${path}`,
    {
      method: init.method ?? 'GET',
      headers,
      body: init.body === undefined ? null : JSON.stringify(init.body),
    },
    testEnv,
  );
}

/**
 * What a browser would send after `res`: the cookies in `jar` (a Cookie header) updated with the
 * ones `res` sets; a cookie set to an empty value is cleared.
 */
export function withCookies(res: Response, jar = ''): string {
  const cookies = new Map(
    jar
      .split('; ')
      .filter(Boolean)
      .map((pair): [string, string] => [pair.slice(0, pair.indexOf('=')), pair]),
  );
  for (const header of res.headers.getSetCookie()) {
    const pair = header.split(';')[0] ?? '';
    const name = pair.slice(0, pair.indexOf('='));
    if (pair.endsWith('=')) cookies.delete(name);
    else cookies.set(name, pair);
  }
  return [...cookies.values()].join('; ');
}

/** The session token alone from a Cookie header: what a browser whose cookie cache lapsed sends. */
export function tokenCookie(cookie: string): string {
  return cookie.split('; ').find((pair) => pair.startsWith(`${SESSION_COOKIE}=`)) ?? '';
}

/**
 * Signs a fresh user up through Better Auth: the response (body already read), the user, its
 * email and the Cookie header a browser would send next (session token and cookie cache).
 */
export async function signUp(testEnv: Env, name = 'Ada Lovelace') {
  const email = `user-${crypto.randomUUID()}@example.com`;
  const res = await authRequest(testEnv, '/sign-up/email', {
    method: 'POST',
    body: { email, password: PASSWORD, name },
  });
  expect(res.status).toBe(200);
  const { user } = await res.json<{ user: { id: string; email: string; name: string } }>();
  const cookie = withCookies(res);
  expect(cookie).toContain(`${SESSION_COOKIE}=`);
  return { res, user, id: user.id, email, cookie };
}
