import { RATE_LIMIT, ROOM, WS } from '@cgis/shared';
import { evictDurableObject, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { type DraftOp, DraftStore } from '../../src/do/drafts';
import { draftUpdate } from '../../src/do/handlers';
import { withRoomUser } from '../../src/do/handoff';
import { attachmentOf } from '../../src/do/presence';
import type { RateLimiter, TakeResult } from '../../src/do/rate-limiter';
import { Room } from '../../src/do/room';
import { socketClient } from './socket-client';

// Wire values (types, codes, payload shapes) are spelled out: they are the contract T8 and T14 use.

/** Any server frame; payloads are checked with toEqual/toMatchObject, so they stay unknown here. */
const FrameSchema = z.object({
  type: z.string(),
  seq: z.number(),
  ts: z.number(),
  payload: z.record(z.string(), z.unknown()),
});
type Frame = z.infer<typeof FrameSchema>;

type Client = {
  userId: string;
  ws: WebSocket;
  frames: Frame[];
  /** Frames of one type, in arrival order. */
  of: (type: string) => Frame[];
  /** Resolves once `of(type)` has `count` frames, with the last of them. */
  waitFor: (type: string, count?: number) => Promise<Frame>;
  closed: Promise<CloseEvent>;
  send: (type: string, payload: unknown, seq?: number) => void;
};

// Timing-dependent tests freeze the clock with vi.setSystemTime: it mocks Date for the whole
// isolate, and the vitest plugin runs the Room in the test isolate, so the Room reads the same
// clock. T0 is far ahead of the real clock: workerd schedules alarms on real time, so an alarm
// armed at a mocked instant in the past would fire mid-test; these tests run alarms with
// runDurableObjectAlarm (see rate-limit/rate-limiter.test.ts).
const T0 = Date.UTC(2100, 0, 1);

/**
 * A user id no other test spends from. Every accepted `draft:update` spends from the user's
 * RateLimiter, whose storage lasts for the whole file; a test that drafts on a mocked clock
 * leaves actions dated T0 that the real clock never prunes.
 */
const drawer = () => `drawer-${crypto.randomUUID()}`;

// Each test gets its own Room (a fresh name): no drafts, counters or alarms leak between tests.
let stub: DurableObjectStub<Room>;
let clients: Client[] = [];

beforeEach(() => {
  stub = env.ROOM.get(env.ROOM.idFromName(crypto.randomUUID()));
  clients = [];
});

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  if (clients.length === 0) return;
  // Eviction waits for in-flight requests; closing the sockets keeps them from outliving the test.
  await evictDurableObject(stub, { webSockets: 'close' });
});

/** Opens a socket the way ws.ts does: straight to the Room, the user in the hand-off headers. */
async function connect(userId: string, name = userId.toUpperCase()): Promise<Client> {
  const upgrade = new Request('http://room/ws', { headers: { Upgrade: 'websocket' } });
  const res = await stub.fetch(withRoomUser(upgrade, { id: userId, name }));
  expect(res.status).toBe(101);
  const ws = res.webSocket;
  if (!ws) throw new Error('expected a webSocket on the 101 response');

  let seq = 0;
  const client: Client = {
    userId,
    ws,
    ...socketClient(ws, (data) => FrameSchema.parse(JSON.parse(data))),
    send(type, payload, explicitSeq) {
      seq = explicitSeq ?? seq + 1;
      ws.send(JSON.stringify({ type, seq, ts: Date.now(), payload }));
    },
  };
  clients.push(client);
  return client;
}

/** Connects and joins; resolves once the joiner has its presence and draft:state replies. */
async function join(userId: string): Promise<Client> {
  const client = await connect(userId);
  client.send('join', { mapId: ROOM.DEFAULT_ROOM_ID });
  await client.waitFor('draft:state');
  return client;
}

/**
 * Frames to one socket arrive in order. A `presence:set` round trip is a barrier: once `client`
 * has the presence it triggers, every frame the Room sent it earlier has arrived.
 */
async function barrier(client: Client): Promise<void> {
  const seen = client.of('presence').length;
  client.send('presence:set', { state: 'viewing' });
  await client.waitFor('presence', seen + 1);
}

const users = (frame: Frame) => frame.payload['users'];
const vertex = (i: number): [number, number] => [34.8 + i / 100, 32];
const add = (i: number) => ({ op: 'add', index: i, vertex: vertex(i) });

describe('join and presence', () => {
  it('two sockets join: both receive presence with 2 users', async () => {
    const a = await join('a');
    const b = await join('b');
    const both = [
      { userId: 'a', name: 'A', color: expect.stringMatching(/^#[0-9a-f]{6}$/), state: 'viewing' },
      { userId: 'b', name: 'B', color: expect.stringMatching(/^#[0-9a-f]{6}$/), state: 'viewing' },
    ];
    expect(users(await a.waitFor('presence', 2))).toEqual(both);
    expect(users(await b.waitFor('presence'))).toEqual(both);
  });

  it('join replies presence then draft:state to the joiner', async () => {
    const a = await join('a');
    expect(a.frames.map((frame) => frame.type)).toEqual(['presence', 'draft:state']);
    expect(a.of('draft:state')[0]?.payload).toEqual({ drafts: [] });
  });

  it('a socket that has not joined is not in presence', async () => {
    await connect('lurker');
    const a = await join('a');
    expect(users(await a.waitFor('presence'))).toEqual([expect.objectContaining({ userId: 'a' })]);
  });

  it('lists a user with two sockets once', async () => {
    const a1 = await join('a');
    await join('a');
    expect(users(await a1.waitFor('presence', 2))).toEqual([
      expect.objectContaining({ userId: 'a' }),
    ]);
  });

  it('presence:set updates the attachment and broadcasts presence to everyone', async () => {
    const a = await join('a');
    const b = await join('b');
    a.send('presence:set', { state: 'drawing' });
    const expected = [
      expect.objectContaining({ userId: 'a', state: 'drawing' }),
      expect.objectContaining({ userId: 'b', state: 'viewing' }),
    ];
    expect(users(await a.waitFor('presence', 3))).toEqual(expected);
    expect(users(await b.waitFor('presence', 2))).toEqual(expected);
    const stored = await runInDurableObject(stub, (_room, state) =>
      state.getWebSockets().map((ws) => attachmentOf(ws)),
    );
    expect(stored).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: 'a', state: 'drawing' }),
        expect.objectContaining({ userId: 'b', state: 'viewing' }),
      ]),
    );
  });

  it('join after A has a draft: draft:state carries A’s vertices', async () => {
    const a = await join('a');
    a.send('draft:update', add(0));
    a.send('draft:update', add(1));
    await barrier(a);
    const b = await join('b');
    expect(b.of('draft:state')[0]?.payload).toEqual({
      drafts: [{ userId: 'a', vertices: [vertex(0), vertex(1)] }],
    });
  });
});

describe('draft:update', () => {
  it('A sends 3 draft:update: B receives 3 (with A’s userId), A receives 0', async () => {
    const a = await join('a');
    const b = await join('b');
    for (const i of [0, 1, 2]) a.send('draft:update', add(i));
    await b.waitFor('draft:update', 3);
    expect(b.of('draft:update').map((frame) => frame.payload)).toEqual([
      { ...add(0), userId: 'a' },
      { ...add(1), userId: 'a' },
      { ...add(2), userId: 'a' },
    ]);
    await barrier(a);
    expect(a.of('draft:update')).toEqual([]);
  });

  it('stamps the sender as userId, overwriting a client-supplied one', async () => {
    const a = await join('a');
    const b = await join('b');
    a.send('draft:update', { ...add(0), userId: 'b' });
    expect((await b.waitFor('draft:update')).payload).toEqual({ ...add(0), userId: 'a' });
    const c = await join('c');
    expect(c.of('draft:state')[0]?.payload).toEqual({
      drafts: [{ userId: 'a', vertices: [vertex(0)] }],
    });
  });

  it(`${WS.DRAFT_RATE_PER_SEC + 1} updates at one instant: the last gets error RATE_LIMITED on A only; B received ${WS.DRAFT_RATE_PER_SEC}`, async () => {
    // Frozen clock: every frame arrives at T0, so the socket's bucket cannot refill mid-burst
    // however long the Room (or a loaded machine) takes to handle them.
    vi.setSystemTime(T0);
    const a = await join(drawer());
    const b = await join('b');
    for (let i = 0; i <= WS.DRAFT_RATE_PER_SEC; i++) a.send('draft:update', add(i));
    const error = await a.waitFor('error');
    expect(error.payload).toEqual({
      code: 'RATE_LIMITED',
      message: 'Too many requests',
      // One token's worth of time: 1 s / DRAFT_RATE_PER_SEC.
      retryAfter: 1000 / WS.DRAFT_RATE_PER_SEC,
    });
    await barrier(a);
    await barrier(b);
    expect(b.of('draft:update')).toHaveLength(WS.DRAFT_RATE_PER_SEC);
    expect(b.of('error')).toEqual([]);
    expect(a.of('error')).toHaveLength(1);
  });

  it('drops frames whose seq is not above the last accepted one', async () => {
    const a = await join('a');
    const b = await join('b');
    a.send('draft:update', add(0), 5);
    a.send('draft:update', add(1), 5);
    a.send('draft:update', add(1), 4);
    a.send('draft:update', add(1), 6);
    await barrier(a);
    await barrier(b);
    expect(b.of('draft:update').map((frame) => frame.payload['index'])).toEqual([0, 1]);
    expect(a.of('error')).toEqual([]);
  });

  it('answers an op that does not fit the draft with DRAFT_OP_MISFIT (resync) and relays nothing', async () => {
    const a = await join('a');
    const b = await join('b');
    a.send('draft:update', add(3));
    expect((await a.waitFor('error')).payload).toEqual({
      code: 'DRAFT_OP_MISFIT',
      message: 'draft op does not fit the current draft',
      resync: true,
    });
    await barrier(b);
    expect(b.of('draft:update')).toEqual([]);
  });

  it('answers a draft:update before join with BAD_REQUEST', async () => {
    const a = await connect('a');
    a.send('draft:update', add(0));
    expect((await a.waitFor('error')).payload).toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('stores the draft in SQLite drafts(user_id, vertices, updated_at)', async () => {
    const a = await join('a');
    a.send('draft:update', add(0));
    await barrier(a);
    const rows = await runInDurableObject(stub, (_room, state) =>
      state.storage.sql.exec('SELECT user_id, vertices, updated_at FROM drafts').toArray(),
    );
    expect(rows).toEqual([
      { user_id: 'a', vertices: JSON.stringify([vertex(0)]), updated_at: expect.any(Number) },
    ]);
  });
});

describe('bad frames', () => {
  it.each([
    ['non-JSON', 'garbage'],
    ['valid JSON, not an envelope', JSON.stringify({ hello: 'world' })],
    ['a server-only event', JSON.stringify({ type: 'presence', seq: 1, ts: 1, payload: {} })],
  ])('%s: error BAD_REQUEST and the socket stays open', async (_label, raw) => {
    const a = await connect('a');
    a.ws.send(raw);
    expect((await a.waitFor('error')).payload).toEqual({
      code: 'BAD_REQUEST',
      message: expect.any(String),
    });
    a.send('join', { mapId: ROOM.DEFAULT_ROOM_ID });
    await a.waitFor('draft:state');
  });

  it('a binary frame: error BAD_REQUEST', async () => {
    const a = await connect('a');
    a.ws.send(new Uint8Array([1, 2, 3]));
    expect((await a.waitFor('error')).payload).toMatchObject({ code: 'BAD_REQUEST' });
  });

  it(`closes with ${WS.CLOSE_POLICY_VIOLATION} at WS.BAD_FRAME_STRIKES (${WS.BAD_FRAME_STRIKES}) bad frames`, async () => {
    const a = await join('a');
    const b = await join('b');
    for (let i = 1; i < WS.BAD_FRAME_STRIKES; i++) a.ws.send('garbage');
    await a.waitFor('error', WS.BAD_FRAME_STRIKES - 1);
    await barrier(a); // still open after BAD_FRAME_STRIKES - 1
    a.ws.send('garbage');
    expect((await a.closed).code).toBe(WS.CLOSE_POLICY_VIOLATION);
    expect(a.of('error')).toHaveLength(WS.BAD_FRAME_STRIKES);
    // A left the room with the close.
    const presence = await b.waitFor('presence', 3);
    expect(users(presence)).toEqual([expect.objectContaining({ userId: 'b' })]);
  });
});

describe('leaving', () => {
  it('leave: deletes the draft, broadcasts presence and draft:state; the socket stays open', async () => {
    const a = await join('a');
    const b = await join('b');
    a.send('draft:update', add(0));
    await b.waitFor('draft:update');
    a.send('leave', {});
    expect(users(await b.waitFor('presence', 2))).toEqual([
      expect.objectContaining({ userId: 'b' }),
    ]);
    expect((await b.waitFor('draft:state', 2)).payload).toEqual({ drafts: [] });
    a.send('join', { mapId: ROOM.DEFAULT_ROOM_ID });
    await a.waitFor('draft:state', 2);
  });

  it('close: deletes the draft and broadcasts presence and draft:state', async () => {
    const a = await join('a');
    const b = await join('b');
    a.send('draft:update', add(0));
    await b.waitFor('draft:update');
    a.ws.close(1000, 'bye');
    expect(users(await b.waitFor('presence', 2))).toEqual([
      expect.objectContaining({ userId: 'b' }),
    ]);
    expect((await b.waitFor('draft:state', 2)).payload).toEqual({ drafts: [] });
  });

  it('closing one of two sockets of a user keeps that user and their draft', async () => {
    const a1 = await join('a');
    const a2 = await join('a');
    const b = await join('b');
    a1.send('draft:update', add(0));
    await b.waitFor('draft:update');
    a2.ws.close(1000, 'second tab closed');
    expect(users(await b.waitFor('presence', 2))).toEqual([
      expect.objectContaining({ userId: 'a' }),
      expect.objectContaining({ userId: 'b' }),
    ]);
    await barrier(b);
    expect(b.of('draft:state')).toHaveLength(1);
    const c = await join('c');
    expect(c.of('draft:state')[0]?.payload).toEqual({
      drafts: [{ userId: 'a', vertices: [vertex(0)] }],
    });
  });
});

describe('outgoing envelope', () => {
  it('stamps seq from a storage counter (increasing across hibernation) and ts = Date.now()', async () => {
    const before = Date.now();
    const a = await join('a');
    await barrier(a);
    await evictDurableObject(stub);
    await barrier(a);
    const seqs = a.frames.map((frame) => frame.seq);
    expect(seqs).toEqual([...seqs].sort((x, y) => x - y));
    expect(new Set(seqs).size).toBe(seqs.length);
    for (const frame of a.frames) expect(frame.ts).toBeGreaterThanOrEqual(before);
  });
});

describe('hibernation', () => {
  it('after eviction, presence is rebuilt from socket attachments', async () => {
    const a = await join('a');
    const b = await join('b');
    a.send('presence:set', { state: 'drawing' });
    await b.waitFor('presence', 2);
    await evictDurableObject(stub); // drops the instance, hibernates the sockets
    b.send('presence:set', { state: 'drawing' });
    expect(users(await a.waitFor('presence', 4))).toEqual([
      expect.objectContaining({ userId: 'a', state: 'drawing' }),
      expect.objectContaining({ userId: 'b', state: 'drawing' }),
    ]);
  });

  it('a fresh Room over the same state answers join from the attachments', async () => {
    await join('a');
    await join('b');
    const c = await connect('c');
    await evictDurableObject(stub);
    await runInDurableObject(stub, async (_room, state) => {
      const fresh = new Room(state, env);
      const socket = state.getWebSockets().find((ws) => attachmentOf(ws)?.userId === 'c');
      if (!socket) throw new Error('expected c’s socket');
      await fresh.webSocketMessage(
        socket,
        JSON.stringify({ type: 'join', seq: 1, ts: 1, payload: { mapId: ROOM.DEFAULT_ROOM_ID } }),
      );
    });
    expect(users(await c.waitFor('presence'))).toEqual([
      expect.objectContaining({ userId: 'a' }),
      expect.objectContaining({ userId: 'b' }),
      expect.objectContaining({ userId: 'c' }),
    ]);
  });
});

describe('alarm', () => {
  it('is scheduled when a socket connects', async () => {
    await connect('a');
    const alarm = await runInDurableObject(stub, (_room, state) => state.storage.getAlarm());
    expect(alarm).toEqual(expect.any(Number));
  });

  it('drops a draft idle for more than WS.PRESENCE_IDLE_MS, broadcasts draft:state, reschedules', async () => {
    const a = await join('a');
    const b = await join('b');
    a.send('draft:update', add(0));
    await b.waitFor('draft:update');
    await runInDurableObject(stub, (_room, state) => {
      state.storage.sql.exec(
        'UPDATE drafts SET updated_at = ?',
        Date.now() - WS.PRESENCE_IDLE_MS - 1,
      );
    });
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect((await b.waitFor('draft:state', 2)).payload).toEqual({ drafts: [] });
    const alarm = await runInDurableObject(stub, (_room, state) => state.storage.getAlarm());
    expect(alarm).toEqual(expect.any(Number));
  });

  it('keeps a fresh draft and broadcasts nothing when nothing changed', async () => {
    const a = await join('a');
    const b = await join('b');
    a.send('draft:update', add(0));
    await b.waitFor('draft:update');
    const before = b.frames.length;
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    await barrier(b);
    expect(b.frames.slice(before).map((frame) => frame.type)).toEqual(['presence']);
  });

  it('closes a socket silent for more than WS.SOCKET_IDLE_MS and drops it from presence', async () => {
    const a = await join('a');
    const b = await join('b');
    await runInDurableObject(stub, (_room, state) => {
      for (const ws of state.getWebSockets()) {
        const attachment = attachmentOf(ws);
        if (attachment?.userId === 'a') {
          ws.serializeAttachment({ ...attachment, lastSeen: Date.now() - WS.SOCKET_IDLE_MS - 1 });
        }
      }
    });
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect((await a.closed).code).toBe(WS.CLOSE_IDLE);
    expect(users(await b.waitFor('presence', 2))).toEqual([
      expect.objectContaining({ userId: 'b' }),
    ]);
  });

  it('does not reschedule once no socket remains', async () => {
    const a = await connect('a');
    a.ws.close(1000, 'bye');
    // A client-initiated close fires no close event on this end in workerd; poll the Room instead.
    await vi.waitFor(async () => {
      const open = await runInDurableObject(
        stub,
        (_room, state) =>
          state.getWebSockets().filter((ws) => ws.readyState === WebSocket.OPEN).length,
      );
      expect(open).toBe(0);
    });
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    const alarm = await runInDurableObject(stub, (_room, state) => state.storage.getAlarm());
    expect(alarm).toBeNull();
  });
});

describe('idle sweep under fake time: drafts expire at 60 s, sockets at WS.SOCKET_IDLE_MS', () => {
  beforeEach(() => {
    vi.setSystemTime(T0);
  });

  const SECOND = 1000;

  it('a socket silent for 61 s (a hidden tab pinging once a minute) stays open and in presence; its draft is dropped', async () => {
    const a = await join(drawer());
    const b = await join('b');
    a.send('draft:update', add(0));
    await b.waitFor('draft:update');
    vi.setSystemTime(T0 + WS.PRESENCE_IDLE_MS + SECOND);
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    // D13: the draft went with the 60 s draft cutoff...
    expect((await b.waitFor('draft:state', 2)).payload).toEqual({ drafts: [] });
    // ...but the socket is still open and joined: its next frame gets a presence with both users
    // (a's third: its join, b's join, this one).
    a.send('presence:set', { state: 'viewing' });
    // Sorted by name: 'B' before 'DRAWER-…'.
    expect(users(await a.waitFor('presence', 3))).toEqual([
      expect.objectContaining({ userId: 'b' }),
      expect.objectContaining({ userId: a.userId }),
    ]);
  });

  it('a socket silent for 91 s is closed with CLOSE_IDLE; one whose frame moved lastSeen stays; presence rebroadcast', async () => {
    const a = await join('a');
    const b = await join('b');
    vi.setSystemTime(T0 + WS.SOCKET_IDLE_MS / 2);
    await barrier(b); // every frame stamps lastSeen
    const sweptAt = T0 + WS.SOCKET_IDLE_MS + SECOND;
    vi.setSystemTime(sweptAt);
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect((await a.closed).code).toBe(WS.CLOSE_IDLE);
    // b: its join presence, its barrier's, then the sweep's.
    expect(users(await b.waitFor('presence', 3))).toEqual([
      expect.objectContaining({ userId: 'b' }),
    ]);
    // The same single alarm re-arms one interval on.
    const alarm = await runInDurableObject(stub, (_room, state) => state.storage.getAlarm());
    expect(alarm).toBe(sweptAt + WS.ALARM_INTERVAL_MS);
  });
});

describe('draft:update spends the per-user draw budget (RateLimiter, D5)', () => {
  const { DRAW_ACTIONS_PER_WINDOW: DRAW_LIMIT, WINDOW_MS, ACTIONS } = RATE_LIMIT;
  /** One frame per this many ms keeps the per-socket bucket full: only the shared budget refuses. */
  const DRAFT_GAP_MS = 1000 / WS.DRAFT_RATE_PER_SEC;

  const limiterOf = (userId: string) => env.RATE_LIMITER.get(env.RATE_LIMITER.idFromName(userId));
  const actionsOf = (userId: string) =>
    runInDurableObject(
      limiterOf(userId),
      (_limiter: RateLimiter, state) =>
        state.storage.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM actions').one().n,
    );
  const draftRows = () =>
    runInDurableObject(stub, (_room, state) =>
      state.storage.sql
        .exec<{ user_id: string; vertices: string }>('SELECT user_id, vertices FROM drafts')
        .toArray(),
    );

  beforeEach(() => {
    vi.setSystemTime(T0);
  });

  it(`the ${DRAW_LIMIT + 1}st draft:update in the window: error RATE_LIMITED with retryAfter (ms), not relayed or stored`, async () => {
    const id = drawer();
    const a = await join(id);
    const b = await join('b');
    for (let i = 0; i < DRAW_LIMIT; i++) {
      vi.setSystemTime(T0 + i * DRAFT_GAP_MS);
      a.send('draft:update', add(i));
      await b.waitFor('draft:update', i + 1);
    }
    vi.setSystemTime(T0 + DRAW_LIMIT * DRAFT_GAP_MS);
    a.send('draft:update', add(DRAW_LIMIT));
    expect((await a.waitFor('error')).payload).toEqual({
      code: 'RATE_LIMITED',
      message: 'Too many requests',
      // Until the first of the 50 leaves the 60 s window.
      retryAfter: WINDOW_MS - DRAW_LIMIT * DRAFT_GAP_MS,
    });
    await barrier(a);
    await barrier(b);
    expect(b.of('draft:update')).toHaveLength(DRAW_LIMIT);
    expect(a.of('error')).toHaveLength(1);
    const [row] = await draftRows();
    expect(JSON.parse(row?.vertices ?? '[]')).toHaveLength(DRAW_LIMIT);
    expect(await actionsOf(id)).toBe(DRAW_LIMIT);
  });

  it('one budget with REST: spent by mutations, a draft:update is refused; after retryAfter it is relayed', async () => {
    const id = drawer();
    for (let i = 0; i < DRAW_LIMIT; i++) await limiterOf(id).take(ACTIONS.DRAW);
    const a = await join(id);
    const b = await join('b');
    a.send('draft:update', add(0));
    const refused = await a.waitFor('error');
    expect(refused.payload).toMatchObject({ code: 'RATE_LIMITED', retryAfter: WINDOW_MS });
    vi.setSystemTime(T0 + Number(refused.payload['retryAfter']));
    a.send('draft:update', add(0));
    expect((await b.waitFor('draft:update')).payload).toEqual({ ...add(0), userId: id });
  });

  it('a frame dropped for its stale or repeated seq spends nothing', async () => {
    const id = drawer();
    const a = await join(id);
    a.send('draft:update', add(0), 5);
    a.send('draft:update', add(1), 5);
    a.send('draft:update', add(1), 4);
    await barrier(a);
    expect(await actionsOf(id)).toBe(1);
  });

  // Driven through the handler with a failing `takeDrawAction`: in this harness a rejected
  // DO-to-DO RPC is reported as an uncaught exception and the Room's eviction then hangs.
  it('fails closed when the RateLimiter call fails: error INTERNAL to the sender, nothing relayed, one log line', async () => {
    const id = drawer();
    const a = await join(id);
    const b = await join('b');
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const takeDrawAction = vi.fn<(userId: string) => Promise<TakeResult>>(async () => {
      throw new Error('limiter down');
    });
    const op: DraftOp = { op: 'add', index: 0, vertex: vertex(0) };
    await runInDurableObject(stub, async (_room, state) => {
      const ws = state.getWebSockets().find((socket) => attachmentOf(socket)?.userId === id);
      const attachment = ws && attachmentOf(ws);
      if (!ws || !attachment) throw new Error('expected the drawer’s socket');
      const room = { ctx: state, drafts: new DraftStore(state.storage.sql), takeDrawAction };
      await draftUpdate(room, { ws, attachment }, 1, op, Date.now());
    });
    expect((await a.waitFor('error')).payload).toEqual({
      code: 'INTERNAL',
      message: 'Internal Server Error',
    });
    await barrier(b);
    expect(b.of('draft:update')).toEqual([]);
    expect(await draftRows()).toEqual([]);
    expect(takeDrawAction).toHaveBeenCalledExactlyOnceWith(id);
    expect(logged).toHaveBeenCalledOnce();
    expect(JSON.parse(String(logged.mock.calls[0]?.[0]))).toEqual({
      level: 'error',
      msg: 'rate limiter call failed',
      error: expect.stringContaining('limiter down'),
    });
  });
});

describe('frame order while a draft:update waits on the RateLimiter', () => {
  it('a leave right behind a draft:update is handled after it: the draft is relayed, then dropped', async () => {
    const a = await join(drawer());
    const b = await join('b');
    a.send('draft:update', add(0));
    a.send('leave', {});
    a.send('join', { mapId: ROOM.DEFAULT_ROOM_ID });
    // The re-join is answered last of the three, so every frame they caused has been sent.
    expect((await a.waitFor('draft:state', 2)).payload).toEqual({ drafts: [] });
    await barrier(b);
    expect(b.of('draft:update')).toHaveLength(1);
    // b's join reply, then the leave dropping the draft that was already relayed. Had the leave
    // overtaken the draft, there would be no second draft:state and the draft would outlive it.
    expect(b.of('draft:state').map((frame) => frame.payload)).toEqual([
      { drafts: [] },
      { drafts: [] },
    ]);
    const rows = await runInDurableObject(stub, (_room, state) =>
      state.storage.sql.exec('SELECT user_id FROM drafts').toArray(),
    );
    expect(rows).toEqual([]);
  });
});
