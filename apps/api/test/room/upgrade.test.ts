import { type AreaEvent, LIMITS, MAP, ROOM, WS } from '@cgis/shared';
import { evictDurableObject, runInDurableObject } from 'cloudflare:test';
import { env, exports } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PresenceAttachmentSchema } from '../../src/do/presence';
import { appWithUser } from '../helpers';

// Wire values are spelled out on purpose: they are the contract other lanes and clients rely on.
const UPGRADE = { Upgrade: 'websocket' };
// What the SPA's browser sends: the Worker refuses an upgrade from any other Origin (TOM-26).
const BROWSER_UPGRADE = { ...UPGRADE, Origin: env.CLIENT_ORIGIN };
const room = () => env.ROOM.get(env.ROOM.idFromName(ROOM.DEFAULT_ROOM_ID));

/** Takes the client end of a 101 and accepts it. */
function socketOf(res: Response): WebSocket {
  expect(res.status).toBe(101);
  const ws = res.webSocket;
  if (!ws) throw new Error('expected a webSocket on the 101 response');
  ws.accept();
  return ws;
}

/** Opens a socket through the Worker's `GET /ws` as a signed-in user. */
async function connect(id: string, name: string): Promise<WebSocket> {
  return socketOf(
    await appWithUser({ id, name }).request('/ws', { headers: BROWSER_UPGRADE }, env),
  );
}

/** Calls the Room directly, the way `wsUpgrade` does, with the trusted user headers. */
function roomFetch(init: RequestInit = {}, path = '/ws'): Promise<Response> {
  return room().fetch(`http://room${path}`, init);
}

/** Resolves with the next text frame `ws` receives. */
function nextMessage(ws: WebSocket): Promise<string> {
  return new Promise((resolve) => {
    ws.addEventListener('message', (event) => resolve(event.data as string), { once: true });
  });
}

const attachments = () =>
  runInDurableObject(room(), (_room, state) =>
    state.getWebSockets().map((ws) => ws.deserializeAttachment() as unknown),
  );
const socketCount = () =>
  runInDurableObject(room(), (_room, state) => state.getWebSockets().length);

const event = (n: number): AreaEvent => ({
  type: 'area:deleted',
  payload: { id: `00000000-0000-4000-8000-00000000000${n}` },
});
/** What a socket receives for `event(n)`: stamped with the Room's `seq`, `ts` and `mapVersion`. */
const received = (n: number) => ({
  ...event(n),
  seq: expect.any(Number),
  ts: expect.any(Number),
  mapVersion: expect.any(Number),
});

afterEach(async () => {
  vi.restoreAllMocks();
  // Storage is per test file, so the default Room outlives a test: close its sockets between tests.
  // Eviction waits for in-flight requests, so every test consumes the response bodies it gets.
  if ((await socketCount()) > 0) await evictDurableObject(room(), { webSockets: 'close' });
});

describe('GET /ws (Worker side)', () => {
  it('upgrades a signed-in user to 101 and a usable socket (ping → pong auto-response)', async () => {
    const ws = await connect('u1', 'Alice');
    const reply = nextMessage(ws);
    ws.send('ping');
    expect(await reply).toBe('pong');
  });

  it('answers 401 UNAUTHORIZED without a session user', async () => {
    const res = await exports.default.fetch('http://x/ws', { headers: UPGRADE });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ code: 'UNAUTHORIZED', message: 'sign in' });
  });

  it.each([{ 'x-user-id': 'u1', 'x-user-name': 'Alice' }, { 'x-debug-user': 'u1:Alice' }])(
    'has no header bypass: %j without a session is 401',
    async (headers) => {
      const res = await exports.default.fetch('http://x/ws', {
        headers: { ...UPGRADE, ...headers },
      });
      expect(res.status).toBe(401);
      await res.body?.cancel();
    },
  );

  it('answers 426 UPGRADE_REQUIRED without Upgrade: websocket', async () => {
    const res = await appWithUser({ id: 'u1', name: 'Alice' }).request('/ws', {}, env);
    expect(res.status).toBe(426);
    expect(await res.json()).toEqual({
      code: 'UPGRADE_REQUIRED',
      message: 'websocket upgrade required',
    });
  });

  it('answers 404 on a path under /ws', async () => {
    const res = await appWithUser({ id: 'u1', name: 'Alice' }).request(
      '/ws/other',
      { headers: UPGRADE },
      env,
    );
    expect(res.status).toBe(404);
    await res.body?.cancel();
  });

  it('overwrites client-sent x-user-id / x-user-name with the session user', async () => {
    const res = await appWithUser({ id: 'u1', name: 'Alice' }).request(
      '/ws',
      { headers: { ...BROWSER_UPGRADE, 'x-user-id': 'admin', 'x-user-name': 'Admin' } },
      env,
    );
    socketOf(res);
    expect(await attachments()).toEqual([expect.objectContaining({ userId: 'u1', name: 'Alice' })]);
  });

  it('carries a name with ":" and non-Latin-1 characters intact', async () => {
    await connect('u-he', 'תומר: cartographer');
    expect(await attachments()).toEqual([expect.objectContaining({ name: 'תומר: cartographer' })]);
  });
});

describe('Room Durable Object', () => {
  const trusted = (id: string, name: string) => ({
    ...UPGRADE,
    'x-user-id': id,
    'x-user-name': encodeURIComponent(name),
  });

  it('accepts a direct upgrade: 101 with the client socket, attachment stored first', async () => {
    const before = Date.now();
    const ws = socketOf(await roomFetch({ headers: trusted('u1', 'Alice') }));
    const [attachment] = await attachments();
    expect(PresenceAttachmentSchema.parse(attachment)).toEqual({
      userId: 'u1',
      name: 'Alice',
      color: expect.any(String),
      state: 'viewing',
      lastSeen: expect.any(Number),
      joined: false,
      strikes: 0,
      tokens: WS.DRAFT_RATE_PER_SEC,
      refilledAt: expect.any(Number),
      lastSeq: null,
      epoch: null,
    });
    const { color, lastSeen } = PresenceAttachmentSchema.parse(attachment);
    expect(MAP.PRESENCE_COLORS).toContain(color);
    expect(lastSeen).toBeGreaterThanOrEqual(before);
    expect(await socketCount()).toBe(1);
    const reply = nextMessage(ws);
    ws.send('ping');
    expect(await reply).toBe('pong');
  });

  it('gives the same user the same colour on every socket', async () => {
    await connect('u7', 'Seven');
    await connect('u7', 'Seven again');
    const colors = (await attachments()).map((a) => PresenceAttachmentSchema.parse(a).color);
    expect(colors).toHaveLength(2);
    expect(colors[0]).toBe(colors[1]);
  });

  it('trims the name and caps it at LIMITS.USER_NAME_MAX, a cut character becoming U+FFFD', async () => {
    const long = `  ${'a'.repeat(LIMITS.USER_NAME_MAX - 1)}😀tail  `;
    socketOf(await roomFetch({ headers: trusted('u1', long) }));
    const [attachment] = await attachments();
    expect(PresenceAttachmentSchema.parse(attachment).name).toBe(
      `${'a'.repeat(LIMITS.USER_NAME_MAX - 1)}�`,
    );
    const padded = await roomFetch({ headers: trusted('u2', '  Bob  ') });
    socketOf(padded);
    expect(await attachments()).toContainEqual(expect.objectContaining({ name: 'Bob' }));
  });

  // workerd sends every `Upgrade: websocket` fetch as GET, so the other methods go without it.
  const user = { 'x-user-id': 'u1', 'x-user-name': 'Alice' };
  it.each([
    ['POST /ws', { method: 'POST', headers: user }, '/ws'],
    ['HEAD /ws', { method: 'HEAD', headers: user }, '/ws'],
    ['GET / (upgrade)', { headers: trusted('u1', 'Alice') }, '/'],
    ['GET /_count', { headers: user }, '/_count'],
  ])('answers 404 NOT_FOUND to %s and keeps no socket', async (_label, init, path) => {
    const res = await roomFetch(init, path);
    expect(res.status).toBe(404);
    await res.body?.cancel();
    expect(await socketCount()).toBe(0);
  });

  it('answers 426 UPGRADE_REQUIRED without Upgrade: websocket', async () => {
    const res = await roomFetch({ headers: { 'x-user-id': 'u1', 'x-user-name': 'Alice' } });
    expect(res.status).toBe(426);
    expect(await res.json()).toMatchObject({ code: 'UPGRADE_REQUIRED' });
  });

  it.each([
    ['no user headers', UPGRADE],
    ['an empty id', trusted('', 'Alice')],
    ['an id over LIMITS.USER_ID_MAX', trusted('x'.repeat(LIMITS.USER_ID_MAX + 1), 'Alice')],
    ['a blank name', trusted('u1', '   ')],
    [
      'a name that is not percent-encoded',
      { ...UPGRADE, 'x-user-id': 'u1', 'x-user-name': '%E0%A4%A' },
    ],
  ])('answers 400 BAD_REQUEST for %s and keeps no socket', async (_label, headers) => {
    const res = await roomFetch({ headers });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'BAD_REQUEST', details: expect.any(Array) });
    expect(await socketCount()).toBe(0);
  });

  it('never throws out of fetch: a failed attach is a logged 500 and leaves no socket', async () => {
    // Attaching happens before acceptWebSocket, so a throw here must not leave a socket behind.
    vi.spyOn(WebSocket.prototype, 'serializeAttachment').mockImplementationOnce(() => {
      throw new Error('boom');
    });
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await roomFetch({ headers: trusted('u1', 'Alice') });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ code: 'INTERNAL', message: 'Internal Server Error' });
    expect(logged).toHaveBeenCalledOnce();
    expect(await socketCount()).toBe(0);
  });

  it('broadcast(event) reaches every connected socket', async () => {
    const a = await connect('u1', 'Alice');
    const b = await connect('u2', 'Bob');
    const [gotA, gotB] = [nextMessage(a), nextMessage(b)];
    await room().broadcast(event(1));
    expect(JSON.parse(await gotA)).toEqual(received(1));
    expect(JSON.parse(await gotB)).toEqual(received(1));
  });

  it('broadcast closes a socket whose attachment is invalid, once, and still reaches the rest', async () => {
    const bad = await connect('u1', 'Alice');
    const good = await connect('u2', 'Bob');
    await runInDurableObject(room(), (_room, state) => {
      const target = state
        .getWebSockets()
        .find((ws) => PresenceAttachmentSchema.parse(ws.deserializeAttachment()).userId === 'u1');
      target?.serializeAttachment({ userId: 'u1' }); // missing fields: not a valid attachment
    });
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const closed = new Promise<number>((resolve) =>
      bad.addEventListener('close', (e) => resolve(e.code), { once: true }),
    );
    const gotGood = nextMessage(good);
    await room().broadcast(event(1));
    await room().broadcast(event(2));
    expect(await closed).toBe(1011);
    expect(JSON.parse(await gotGood)).toEqual(received(1));
    expect(logged).toHaveBeenCalledOnce();
  });

  it('keeps sockets, attachments and the auto-response across hibernation', async () => {
    const ws = await connect('u1', 'Alice');
    const before = await attachments();
    await evictDurableObject(room()); // default: hibernate sockets, drop the instance
    expect(await attachments()).toEqual(before);
    expect(await socketCount()).toBe(1);
    const reply = nextMessage(ws);
    ws.send('ping');
    expect(await reply).toBe('pong');
  });
});
