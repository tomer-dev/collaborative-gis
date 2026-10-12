import { ROUTES } from '@cgis/shared';
import { env } from 'cloudflare:workers';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp, type Env } from '../../src/app';
import { requireUser } from '../../src/middleware/require-user';
import { laneEnv } from './lane-db';
import { SESSION_COOKIE, signUp } from './session';

// Wire values are spelled out on purpose: they are the contract the SPA relies on.
const UNREACHABLE_DB = 'postgresql://nobody:x@127.0.0.1:1/none';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

let authEnv: Env;
beforeAll(async () => {
  authEnv = await laneEnv('cgis_auth');
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** `authEnv` with the database unreachable: any query fails. */
const offline = (): Env => ({
  ...authEnv,
  HYPERDRIVE: { ...authEnv.HYPERDRIVE, connectionString: UNREACHABLE_DB },
});

/** The real app (chain with `attachUser()`, real onError) plus test-only routes. */
function testApp() {
  const app = createApp();
  app.get('/t/protected', requireUser(), (c) => c.json({ id: c.get('user').id }));
  app.get('/t/whoami', (c) => c.json({ user: c.get('user') ?? null }));
  return app;
}

const get = (path: string, headers: HeadersInit = {}, testEnv: Env = authEnv) =>
  testApp().request(path, { headers }, testEnv);

describe('requireUser() (TOM-26)', () => {
  it('lets a signed-in request through with c.get("user") set to the session user', async () => {
    const { id, cookie } = await signUp(authEnv);
    const res = await get('/t/protected', { cookie });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id });
  });

  it('answers 401 { code: UNAUTHORIZED, message: "sign in" } as JSON without a cookie', async () => {
    const res = await get('/t/protected');
    expect(res.status).toBe(401);
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(await res.json()).toEqual({ code: 'UNAUTHORIZED', message: 'sign in' });
  });

  it.each([
    ['a garbage session cookie', `${SESSION_COOKIE}=garbage`],
    ['a token.signature shaped garbage cookie', `${SESSION_COOKIE}=abc.Zm9yZ2Vk`],
    ['only an unrelated cookie', 'theme=dark'],
  ])('answers 401, not 500, with %s', async (_label, cookie) => {
    const res = await get('/t/protected', { cookie });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ code: 'UNAUTHORIZED', message: 'sign in' });
  });

  it('answers 401 for a real session token whose signature was tampered with', async () => {
    const { cookie } = await signUp(authEnv);
    // `<token>.<hmac>`: flip the first HMAC character (the last one partly holds padding bits).
    const at = cookie.lastIndexOf('.') + 1;
    const forged = `${cookie.slice(0, at)}${cookie[at] === 'A' ? 'B' : 'A'}${cookie.slice(at + 1)}`;
    expect(forged).not.toBe(cookie);
    const res = await get('/t/protected', { cookie: forged });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ code: 'UNAUTHORIZED', message: 'sign in' });
  });

  it('answers 401 once the session is signed out', async () => {
    const { cookie } = await signUp(authEnv);
    const signOut = await createApp().request(
      `${env.BETTER_AUTH_URL}${ROUTES.AUTH}/sign-out`,
      {
        method: 'POST',
        headers: { origin: env.CLIENT_ORIGIN, 'content-type': 'application/json', cookie },
        body: '{}',
      },
      authEnv,
    );
    expect(signOut.status).toBe(200);
    expect((await get('/t/protected', { cookie })).status).toBe(401);
  });
});

describe('attachUser() (TOM-26)', () => {
  it('leaves c.get("user") undefined on an anonymous request, which still succeeds', async () => {
    const res = await get('/t/whoami');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ user: null });
  });

  it('never touches the database without a cookie (anonymous works with the DB unreachable)', async () => {
    const res = await get('/t/whoami', {}, offline());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ user: null });
  });

  it('never touches the database for cookies that are not the session cookie', async () => {
    const res = await get('/t/whoami', { cookie: 'theme=dark; consent=yes' }, offline());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ user: null });
  });

  it.each(['theme=dark', `${SESSION_COOKIE}=abc.def`])(
    'skips the session lookup on the health paths: database down + cookie %s → /readyz 503, /healthz 200',
    async (cookie) => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const ready = await get(ROUTES.READYZ, { cookie }, offline());
      expect(ready.status).toBe(503);
      expect(await ready.json()).toEqual({ code: 'NOT_READY', message: 'database unreachable' });
      expect((await get(ROUTES.HEALTHZ, { cookie }, offline())).status).toBe(200);
    },
  );

  it('sets c.get("user") to { id, name } from a valid session cookie on any route', async () => {
    const { id, cookie } = await signUp(authEnv);
    const res = await get('/t/whoami', { cookie });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ user: { id, name: 'Ada Lovelace' } });
  });

  it('a session lookup that fails (database down) is a 500 INTERNAL, not an anonymous request', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await get(
      '/t/whoami',
      { cookie: `${SESSION_COOKIE}=abc.def`, origin: env.CLIENT_ORIGIN },
      offline(),
    );
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ code: 'INTERNAL', message: 'Internal Server Error' });
    // attachUser() runs last in the chain, so the error still carries CORS and the request id.
    expect(res.headers.get('access-control-allow-origin')).toBe(env.CLIENT_ORIGIN);
    expect(res.headers.get('x-request-id')).toMatch(UUID);
    expect(logged).toHaveBeenCalled();
  });
});
