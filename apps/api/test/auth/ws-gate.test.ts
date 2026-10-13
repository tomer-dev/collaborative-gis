import { ROOM, ROUTES } from '@cgis/shared';
import { evictDurableObject, runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { TEST } from '../helpers';
import { createApp, type Env } from '../../src/app';
import { laneEnv } from './lane-db';
import { SESSION_COOKIE, signUp } from './session';

// Wire values are spelled out on purpose: they are the contract the SPA and browsers rely on.
const UPGRADE = { Upgrade: 'websocket' };
const SIGN_IN = { code: 'UNAUTHORIZED', message: 'sign in' };
const ORIGIN_NOT_ALLOWED = { code: 'FORBIDDEN', message: 'origin not allowed' };

let authEnv: Env;
beforeAll(async () => {
  authEnv = await laneEnv('cgis_auth');
});

const room = () => env.ROOM.get(env.ROOM.idFromName(ROOM.DEFAULT_ROOM_ID));
const roomUsers = () =>
  runInDurableObject(room(), (_room, state) =>
    state.getWebSockets().map((ws): unknown => ws.deserializeAttachment()),
  );

afterEach(async () => {
  // Storage is per test file, so the Room outlives a test: close its sockets between tests.
  if ((await roomUsers()).length > 0) await evictDurableObject(room(), { webSockets: 'close' });
});

/** `GET /ws` through the real app (real chain, real `/ws` route) against the cgis_auth database. */
const openWs = (headers: Record<string, string>) =>
  createApp().request(ROUTES.WS, { headers }, authEnv);

/** Asserts a refusal: the status and body, no socket handed out, none kept by the Room. */
async function expectRefused(res: Response, status: number, body: unknown) {
  expect(res.status).toBe(status);
  expect(res.webSocket).toBeNull();
  expect(await res.json()).toEqual(body);
  expect(await roomUsers()).toEqual([]);
}

// Real sign-ups (scrypt, Better Auth's first import): { timeout } for a loaded machine.
describe('GET /ws session gate (TOM-26)', { timeout: TEST.SLOW_TIMEOUT_MS }, () => {
  it('upgrades a signed-in browser on CLIENT_ORIGIN to 101, as the session user', async () => {
    const { id, cookie } = await signUp(authEnv);
    const res = await openWs({ ...UPGRADE, cookie, origin: env.CLIENT_ORIGIN });
    expect(res.status).toBe(101);
    const ws = res.webSocket;
    if (!ws) throw new Error('expected a webSocket on the 101 response');
    ws.accept();
    expect(await roomUsers()).toEqual([
      expect.objectContaining({ userId: id, name: 'Ada Lovelace' }),
    ]);
    ws.close(1000);
  });

  it('answers 401 without a session cookie and opens no socket', async () => {
    await expectRefused(await openWs({ ...UPGRADE, origin: env.CLIENT_ORIGIN }), 401, SIGN_IN);
  });

  it('answers 401 with a session cookie that is not a session', async () => {
    const res = await openWs({
      ...UPGRADE,
      cookie: `${SESSION_COOKIE}=garbage`,
      origin: env.CLIENT_ORIGIN,
    });
    await expectRefused(res, 401, SIGN_IN);
  });

  it('answers 403 to a signed-in upgrade from a foreign Origin and opens no socket', async () => {
    const { cookie } = await signUp(authEnv);
    const res = await openWs({ ...UPGRADE, cookie, origin: 'https://evil.example' });
    await expectRefused(res, 403, ORIGIN_NOT_ALLOWED);
  });

  it('answers 403 to a signed-in upgrade without an Origin header (not a browser)', async () => {
    const { cookie } = await signUp(authEnv);
    await expectRefused(await openWs({ ...UPGRADE, cookie }), 403, ORIGIN_NOT_ALLOWED);
  });

  it.each([
    ['the literal null of an opaque origin', 'null'],
    ['another port', 'http://localhost:5174'],
    ['another scheme', 'https://localhost:5173'],
    ['a look-alike host', 'http://localhost.evil.example:5173'],
    ['an unparsable value', 'not a url'],
  ])('answers 403 to Origin: %s', async (_label, origin) => {
    const { cookie } = await signUp(authEnv);
    await expectRefused(await openWs({ ...UPGRADE, cookie, origin }), 403, ORIGIN_NOT_ALLOWED);
  });

  it('answers 426 to a signed-in request without Upgrade: websocket, after the session check', async () => {
    const { cookie } = await signUp(authEnv);
    const res = await openWs({ cookie, origin: env.CLIENT_ORIGIN });
    await expectRefused(res, 426, {
      code: 'UPGRADE_REQUIRED',
      message: 'websocket upgrade required',
    });
    // The session is checked first: an anonymous non-upgrade request is a 401, not a 426.
    await expectRefused(await openWs({ origin: env.CLIENT_ORIGIN }), 401, SIGN_IN);
  });
});
