import { MAP, ROOM, type WsEvent } from '@cgis/shared';
import { evictDurableObject, runInDurableObject } from 'cloudflare:test';
import { env, exports } from 'cloudflare:workers';
import { Hono } from 'hono';
import { afterEach, describe, expect, it } from 'vitest';
import { type AppEnv, createApp } from '../../src/app';
import { Room } from '../../src/do/room';
import { wsUpgrade } from '../../src/ws';

// Wire values are spelled out on purpose: they are the contract other lanes and clients rely on.
const UPGRADE = { Upgrade: 'websocket' };
const room = () => env.ROOM.get(env.ROOM.idFromName(ROOM.DEFAULT_ROOM_ID));

let opened = false;

/** Opens a socket through the Worker as `x-debug-user: <id>:<name>`. */
async function connect(debugUser: string): Promise<WebSocket> {
  const res = await exports.default.fetch('http://x/ws', {
    headers: { ...UPGRADE, 'x-debug-user': debugUser },
  });
  expect(res.status).toBe(101);
  const ws = res.webSocket;
  if (!ws) throw new Error('expected a webSocket on the 101 response');
  ws.accept();
  opened = true;
  return ws;
}

/** The Worker's `/ws` route behind a stand-in for T5's session middleware (`c.set('user', …)`). */
function withSession(user: { id: string; name: string }) {
  return new Hono<AppEnv>()
    .use(async (c, next) => {
      c.set('user', user);
      await next();
    })
    .get('/ws', wsUpgrade);
}

/** Resolves with the next text frame `ws` receives. */
function nextMessage(ws: WebSocket): Promise<string> {
  return new Promise((resolve) => {
    ws.addEventListener('message', (event) => resolve(event.data as string), { once: true });
  });
}

async function count(): Promise<number> {
  const res = await room().fetch('http://room/_count');
  expect(res.status).toBe(200);
  const body = await res.json<{ count: number }>();
  return body.count;
}

const event = (seq: number): WsEvent => ({
  type: 'area:deleted',
  seq,
  ts: 1_700_000_000_000,
  payload: { id: '00000000-0000-4000-8000-000000000000' },
});

afterEach(async () => {
  // Storage is per test file, so the default Room outlives a test: close its sockets between tests.
  // Eviction waits for in-flight requests, so every test consumes the response bodies it gets.
  if (!opened) return;
  opened = false;
  await evictDurableObject(room(), { webSockets: 'close' });
});

describe('GET /ws upgrade (Worker side)', () => {
  it('upgrades with x-debug-user to 101 and a usable socket (ping → pong auto-response)', async () => {
    const ws = await connect('u1:Alice');
    const reply = nextMessage(ws);
    ws.send('ping');
    expect(await reply).toBe('pong');
  });

  it('answers 401 UNAUTHORIZED without a user', async () => {
    const res = await exports.default.fetch('http://x/ws', { headers: UPGRADE });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ code: 'UNAUTHORIZED', message: 'sign in' });
  });

  it.each(['no-separator', ':name-without-id', 'id-without-name:'])(
    'answers 401 for a malformed x-debug-user %j',
    async (debugUser) => {
      const res = await exports.default.fetch('http://x/ws', {
        headers: { ...UPGRADE, 'x-debug-user': debugUser },
      });
      expect(res.status).toBe(401);
      await res.body?.cancel();
    },
  );

  it('ignores x-debug-user when DEBUG_STUB_AUTH is off', async () => {
    const res = await createApp().request(
      '/ws',
      { headers: { ...UPGRADE, 'x-debug-user': 'u1:Alice' } },
      { ...env, DEBUG_STUB_AUTH: '0' },
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ code: 'UNAUTHORIZED', message: 'sign in' });
  });

  it('takes the user from the session (c.get("user")) without the debug flag', async () => {
    const res = await withSession({ id: 'session-user', name: 'Session User' }).request(
      '/ws',
      { headers: UPGRADE },
      { ...env, DEBUG_STUB_AUTH: '0' },
    );
    expect(res.status).toBe(101);
    res.webSocket?.accept();
    opened = true;
    const ids = await runInDurableObject(room(), (_room, state) =>
      state.getWebSockets().map((ws) => (ws.deserializeAttachment() as { userId: string }).userId),
    );
    expect(ids).toEqual(['session-user']);
  });

  it('answers 426 UPGRADE_REQUIRED without Upgrade: websocket', async () => {
    const res = await exports.default.fetch('http://x/ws', {
      headers: { 'x-debug-user': 'u1:Alice' },
    });
    expect(res.status).toBe(426);
    expect(await res.json()).toEqual({
      code: 'UPGRADE_REQUIRED',
      message: 'websocket upgrade required',
    });
  });

  it('answers 404 on a path under /ws', async () => {
    const res = await exports.default.fetch('http://x/ws/other', {
      headers: { ...UPGRADE, 'x-debug-user': 'u1:Alice' },
    });
    expect(res.status).toBe(404);
    await res.body?.cancel();
  });
});

describe('Room Durable Object', () => {
  it('stores the attachment { userId, name, color, state, lastSeen } on accept', async () => {
    const before = Date.now();
    await connect('u1:Alice');
    const [attachment] = await runInDurableObject(room(), (_room, state) =>
      state.getWebSockets().map((ws) => ws.deserializeAttachment() as Record<string, unknown>),
    );
    expect(attachment).toEqual({
      userId: 'u1',
      name: 'Alice',
      color: expect.stringMatching(/^#[0-9a-f]{6}$/),
      state: 'viewing',
      lastSeen: expect.any(Number),
    });
    expect(MAP.PRESENCE_COLORS).toContain(attachment?.color);
    expect(attachment?.lastSeen).toBeGreaterThanOrEqual(before);
  });

  it('keeps a session name with ":" and non-Latin-1 characters intact', async () => {
    const ok = await withSession({ id: 'u-he', name: 'תומר: cartographer' }).request(
      '/ws',
      { headers: UPGRADE },
      env,
    );
    expect(ok.status).toBe(101);
    ok.webSocket?.accept();
    opened = true;
    const [name] = await runInDurableObject(room(), (_room, state) =>
      state.getWebSockets().map((ws) => (ws.deserializeAttachment() as { name: string }).name),
    );
    expect(name).toBe('תומר: cartographer');
  });

  it('fails a user whose attachment would exceed 16 KiB without leaving a socket behind', async () => {
    const res = await withSession({ id: 'big', name: 'x'.repeat(17 * 1024) }).request(
      '/ws',
      { headers: UPGRADE },
      env,
    );
    expect(res.status).toBe(500);
    await res.body?.cancel();
    expect(await count()).toBe(0);
  });

  it('cannot be spoofed with client-sent x-user-id / x-user-name headers', async () => {
    const res = await exports.default.fetch('http://x/ws', {
      headers: {
        ...UPGRADE,
        'x-debug-user': 'u1:Alice',
        'x-user-id': 'admin',
        'x-user-name': 'Admin',
      },
    });
    expect(res.status).toBe(101);
    res.webSocket?.accept();
    opened = true;
    const [attachment] = await runInDurableObject(room(), (_room, state) =>
      state.getWebSockets().map((ws) => ws.deserializeAttachment() as Record<string, unknown>),
    );
    expect(attachment).toMatchObject({ userId: 'u1', name: 'Alice' });
  });

  it('gives the same user the same colour on every socket', async () => {
    await connect('u7:Seven');
    await connect('u7:Seven again');
    const colors = await runInDurableObject(room(), (_room, state) =>
      state.getWebSockets().map((ws) => (ws.deserializeAttachment() as { color: string }).color),
    );
    expect(colors).toHaveLength(2);
    expect(colors[0]).toBe(colors[1]);
  });

  it('GET /_count reports ctx.getWebSockets().length (1 after one connection)', async () => {
    await connect('u1:Alice');
    expect(await count()).toBe(1);
  });

  it('GET /_count is 404 when DEBUG_STUB_AUTH is off', async () => {
    await connect('u1:Alice');
    const status = await runInDurableObject(room(), async (_room, state) => {
      const res = await new Room(state, { ...env, DEBUG_STUB_AUTH: '0' }).fetch(
        new Request('http://room/_count'),
      );
      await res.body?.cancel();
      return res.status;
    });
    expect(status).toBe(404);
  });

  it('answers 426 to a direct request without Upgrade and 401 without the user headers', async () => {
    const noUpgrade = await room().fetch('http://room/ws', {
      headers: { 'x-user-id': 'u1', 'x-user-name': 'Alice' },
    });
    expect(noUpgrade.status).toBe(426);
    await noUpgrade.body?.cancel();
    const noUser = await room().fetch('http://room/ws', { headers: UPGRADE });
    expect(noUser.status).toBe(401);
    expect(await noUser.json()).toEqual({ code: 'UNAUTHORIZED', message: 'sign in' });
  });

  it('broadcast(event) reaches every connected socket', async () => {
    const a = await connect('u1:Alice');
    const b = await connect('u2:Bob');
    const [gotA, gotB] = [nextMessage(a), nextMessage(b)];
    await room().broadcast(event(1));
    expect(JSON.parse(await gotA)).toEqual(event(1));
    expect(JSON.parse(await gotB)).toEqual(event(1));
  });

  it('broadcast(event, exceptUserId) skips that user', async () => {
    const a = await connect('u1:Alice');
    const b = await connect('u2:Bob');
    const [gotA, gotB] = [nextMessage(a), nextMessage(b)];
    await room().broadcast(event(1), 'u1');
    await room().broadcast(event(2));
    // Frames arrive in order, so Alice's first frame being seq 2 proves she never got seq 1.
    expect(JSON.parse(await gotA)).toEqual(event(2));
    expect(JSON.parse(await gotB)).toEqual(event(1));
  });

  it('keeps sockets, attachments and the auto-response across hibernation', async () => {
    const ws = await connect('u1:Alice');
    const before = await runInDurableObject(room(), (_room, state) =>
      state.getWebSockets().map((s) => s.deserializeAttachment() as unknown),
    );
    await evictDurableObject(room()); // default: hibernate sockets, drop the instance
    const after = await runInDurableObject(room(), (_room, state) =>
      state.getWebSockets().map((s) => s.deserializeAttachment() as unknown),
    );
    expect(after).toEqual(before);
    expect(await count()).toBe(1);
    const reply = nextMessage(ws);
    ws.send('ping');
    expect(await reply).toBe('pong');
  });
});
