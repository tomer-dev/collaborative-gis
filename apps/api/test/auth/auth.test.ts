import { ROUTES } from '@cgis/shared';
import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp, type Env } from '../../src/app';
import { getSessionUser } from '../../src/auth';
import { laneEnv } from './lane-db';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SESSION_COOKIE = 'better-auth.session_token';
const EVIL_ORIGIN = 'http://evil.example';
const PASSWORD = 'correct horse battery staple';

let authEnv: Env;
beforeAll(async () => {
  authEnv = await laneEnv('cgis_auth');
});

/** One request through the real app (middleware chain included) against the cgis_auth database. */
function call(path: string, init: { method?: string; body?: unknown; headers?: HeadersInit } = {}) {
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
    authEnv,
  );
}

/** `name=value` of the session cookie a response sets. */
function sessionCookie(res: Response): string {
  const cookie = res.headers
    .getSetCookie()
    .find((c) => c.startsWith(`${SESSION_COOKIE}=`) && !c.startsWith(`${SESSION_COOKIE}=;`));
  if (!cookie) throw new Error(`no ${SESSION_COOKIE} in set-cookie`);
  return cookie.split(';')[0]!;
}

async function signUp() {
  const email = `ada-${crypto.randomUUID()}@example.com`;
  const res = await call('/sign-up/email', {
    method: 'POST',
    body: { email, password: PASSWORD, name: 'Ada Lovelace' },
  });
  return { res, email };
}

describe('Better Auth on Workers (TOM-25)', () => {
  it('sign-up answers 200 with the user and a session cookie', async () => {
    const { res, email } = await signUp();
    expect(res.status).toBe(200);
    const body = await res.json<{ user: { id: string; email: string; name: string } }>();
    expect(body.user).toMatchObject({ email, name: 'Ada Lovelace' });
    const cookie = res.headers.getSetCookie().find((c) => c.startsWith(`${SESSION_COOKIE}=`));
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    // The cross-cutting chain wraps the auth handler too.
    expect(res.headers.get('x-request-id')).toMatch(UUID);
    expect(res.headers.get('access-control-allow-origin')).toBe(env.CLIENT_ORIGIN);
  });

  it('sign-in, then get-session with the cookie returns the user; without it, null', async () => {
    const { email } = await signUp();
    const signIn = await call('/sign-in/email', {
      method: 'POST',
      body: { email, password: PASSWORD },
      headers: { 'cf-connecting-ip': '203.0.113.7' },
    });
    expect(signIn.status).toBe(200);
    const cookie = sessionCookie(signIn);

    const withCookie = await call('/get-session', { headers: { cookie } });
    expect(withCookie.status).toBe(200);
    const session = await withCookie.json<{
      user: { email: string };
      session: { ipAddress: string };
    }>();
    expect(session.user.email).toBe(email);
    // advanced.ipAddress.ipAddressHeaders reads Cloudflare's client IP header.
    expect(session.session.ipAddress).toBe('203.0.113.7');

    const without = await call('/get-session');
    expect(without.status).toBe(200);
    expect(await without.json()).toBeNull();
  });

  it('getSessionUser resolves { id, name } from the Cookie header alone, and null after sign-out', async () => {
    const { res } = await signUp();
    const { user } = await res.json<{ user: { id: string } }>();
    const cookie = sessionCookie(res);

    expect(await getSessionUser(authEnv, new Headers({ cookie }))).toEqual({
      id: user.id,
      name: 'Ada Lovelace',
    });
    expect(await getSessionUser(authEnv, new Headers())).toBeNull();

    const signOut = await call('/sign-out', { method: 'POST', body: {}, headers: { cookie } });
    expect(signOut.status).toBe(200);
    expect(await getSessionUser(authEnv, new Headers({ cookie }))).toBeNull();
    expect(await (await call('/get-session', { headers: { cookie } })).json()).toBeNull();
  });

  it('a wrong password answers 401 and sets no session cookie', async () => {
    const { email } = await signUp();
    const res = await call('/sign-in/email', {
      method: 'POST',
      body: { email, password: 'not the password' },
    });
    expect(res.status).toBe(401);
    expect(res.headers.getSetCookie().some((c) => c.startsWith(`${SESSION_COOKIE}=`))).toBe(false);
  });

  it('a request from an untrusted Origin answers 403', async () => {
    const { res, email } = await signUp();
    const cookie = sessionCookie(res);

    const signIn = await call('/sign-in/email', {
      method: 'POST',
      body: { email, password: PASSWORD },
      headers: { origin: EVIL_ORIGIN },
    });
    expect(signIn.status).toBe(403);
    expect(signIn.headers.getSetCookie()).toEqual([]);

    // A cross-site sign-out carrying the victim's cookie is refused; the session survives.
    const signOut = await call('/sign-out', {
      method: 'POST',
      body: {},
      headers: { origin: EVIL_ORIGIN, cookie },
    });
    expect(signOut.status).toBe(403);
    expect(await getSessionUser(authEnv, new Headers({ cookie }))).not.toBeNull();
  });
});
