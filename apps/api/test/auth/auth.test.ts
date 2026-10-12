import { env } from 'cloudflare:workers';
import pg from 'pg';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ERROR_REASONS, LIMITS, ROUTES } from '@cgis/shared';
import { createApp, type Env } from '../../src/app';
import { readSession } from '../../src/auth';
import { laneEnv } from './lane-db';
import { authRequest, PASSWORD, SESSION_COOKIE, signUp, tokenCookie, withCookies } from './session';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const EVIL_ORIGIN = 'http://evil.example';
const SESSION_DATA_COOKIE = 'better-auth.session_data';

let authEnv: Env;
beforeAll(async () => {
  authEnv = await laneEnv('cgis_auth');
});

/** One Better Auth request through the real app against the cgis_auth database. */
const call = (path: string, init?: Parameters<typeof authRequest>[2]) =>
  authRequest(authEnv, path, init);

describe('Better Auth on Workers (TOM-25)', () => {
  it('sign-up answers 200 with the user and a session cookie', async () => {
    const { res, user, email } = await signUp(authEnv);
    expect(res.status).toBe(200);
    expect(user).toMatchObject({ email, name: 'Ada Lovelace' });
    const cookie = res.headers.getSetCookie().find((c) => c.startsWith(`${SESSION_COOKIE}=`));
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    // The cross-cutting chain wraps the auth handler too.
    expect(res.headers.get('x-request-id')).toMatch(UUID);
    expect(res.headers.get('access-control-allow-origin')).toBe(env.CLIENT_ORIGIN);
  });

  it('sign-in, then get-session with the cookie returns the user; without it, null', async () => {
    const { email } = await signUp(authEnv);
    const signIn = await call('/sign-in/email', {
      method: 'POST',
      body: { email, password: PASSWORD },
      headers: { 'cf-connecting-ip': '203.0.113.7' },
    });
    expect(signIn.status).toBe(200);
    const cookie = withCookies(signIn);

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

  it('readSession resolves { id, name } from the Cookie header alone, and null after sign-out', async () => {
    const { id, cookie } = await signUp(authEnv);

    expect((await readSession(authEnv, new Headers({ cookie }))).user).toEqual({
      id,
      name: 'Ada Lovelace',
    });
    expect((await readSession(authEnv, new Headers())).user).toBeNull();

    const signOut = await call('/sign-out', { method: 'POST', body: {}, headers: { cookie } });
    expect(signOut.status).toBe(200);
    // The browser drops every auth cookie, and the session row is gone: the old token is refused.
    expect(withCookies(signOut, cookie)).toBe('');
    const token = tokenCookie(cookie);
    expect((await readSession(authEnv, new Headers({ cookie: token }))).user).toBeNull();
    expect(await (await call('/get-session', { headers: { cookie: token } })).json()).toBeNull();
  });

  it('sign-up trims the name and refuses one over LIMITS.USER_NAME_MAX with 422', async () => {
    const longest = 'a'.repeat(LIMITS.USER_NAME_MAX);
    const { user } = await signUp(authEnv, `  ${longest}  `);
    expect(user.name).toBe(longest);

    const email = `user-${crypto.randomUUID()}@example.com`;
    const res = await call('/sign-up/email', {
      method: 'POST',
      body: { email, password: PASSWORD, name: `${longest}a` },
    });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ message: ERROR_REASONS.NAME_TOO_LONG });
    expect(res.headers.getSetCookie().some((c) => c.startsWith(`${SESSION_COOKIE}=`))).toBe(false);
  });

  it('a wrong password answers 401 and sets no session cookie', async () => {
    const { email } = await signUp(authEnv);
    const res = await call('/sign-in/email', {
      method: 'POST',
      body: { email, password: 'not the password' },
    });
    expect(res.status).toBe(401);
    expect(res.headers.getSetCookie().some((c) => c.startsWith(`${SESSION_COOKIE}=`))).toBe(false);
  });

  it('a request from an untrusted Origin answers 403', async () => {
    const { email, cookie } = await signUp(authEnv);

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
    expect((await readSession(authEnv, new Headers({ cookie }))).user).not.toBeNull();
  });
});

describe('session cookie cache (D24)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** A signed-in API call (the areas list) with the Cookie header `cookie`. */
  const listAreas = (cookie: string) =>
    createApp().request(`${ROUTES.AREAS}?bbox=34,31,35,32`, { headers: { cookie } }, authEnv);

  it('reads the session row once per cache window; a same-device sign-out ends it at once', async () => {
    const { cookie } = await signUp(authEnv);
    expect(cookie).toContain(`${SESSION_DATA_COOKIE}=`);
    // A browser whose cache cookie has lapsed sends the session token alone.
    let jar = tokenCookie(cookie);
    const query = vi.spyOn(pg.Client.prototype, 'query');
    const sessionReads = () =>
      query.mock.calls.filter(([statement]) => /\bsession\b/.test(JSON.stringify(statement)))
        .length;

    const first = await listAreas(jar);
    expect(first.status).toBe(200);
    expect(sessionReads()).toBe(1);
    // The read set a fresh cache cookie, which the next request carries.
    jar = withCookies(first, jar);
    expect(jar).toContain(`${SESSION_DATA_COOKIE}=`);

    const second = await listAreas(jar);
    expect(second.status).toBe(200);
    expect(sessionReads()).toBe(1);

    const signOut = await call('/sign-out', { method: 'POST', body: {}, headers: { cookie: jar } });
    expect(signOut.status).toBe(200);
    jar = withCookies(signOut, jar);
    const after = await listAreas(jar);
    expect(after.status).toBe(401);
  });
});
