import { type Area, RATE_LIMIT, ROOM, WS } from '@cgis/shared';
import { evictDurableObject, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { Env } from '../../src/app';
import { type DraftOp, DraftStore } from '../../src/do/drafts';
import { draftUpdate, type RoomCtx } from '../../src/do/handlers';
import { withRoomUser } from '../../src/do/handoff';
import { attachmentOf } from '../../src/do/presence';
import type { RateLimiter, TakeResult } from '../../src/do/rate-limiter';
import type { Room } from '../../src/do/room';
import { areasClient, areasEnv, freshUser, randomSpot, squareAt } from '../areas/fixtures';
import { TEST, type User } from '../helpers';
import { socketClient } from './socket-client';

// D5 (owner ruling, 2026-10-13): a `draft:update` frame is not a drawing action. One draft session,
// from the `add` that starts a draft to its save (the drafter's area create) or the idle sweep,
// spends ONE action from the user's RateLimiter budget, shared with REST mutations. A `clear` and
// the `add`s after it (a resync replay, a cancel and redraw) stay in the open session.

const { DRAW_ACTIONS_PER_WINDOW: DRAW_LIMIT, WINDOW_MS, ACTIONS } = RATE_LIMIT;
/** One frame per this many ms keeps the per-socket bucket full: only the shared budget refuses. */
const DRAFT_GAP_MS = 1000 / WS.DRAFT_RATE_PER_SEC;
/** More frames than the whole budget, all in one session. */
const SESSION_FRAMES = DRAW_LIMIT + 10;
/** An explicit `seq` for a frame the Room will refuse, so its `error` can be matched to it. */
const REFUSED_SEQ = 1000;
// Frozen-clock tests: see protocol-harness.ts. Far ahead of the real clock, so an alarm armed at a
// mocked instant never fires on its own; the tests run alarms with runDurableObjectAlarm.
const T0 = Date.UTC(2100, 0, 1);

const FrameSchema = z.object({
  type: z.string(),
  seq: z.number(),
  ts: z.number(),
  payload: z.record(z.string(), z.unknown()),
});
type Frame = z.infer<typeof FrameSchema>;
type Client = ReturnType<typeof socketClient<Frame>> & {
  userId: string;
  ws: WebSocket;
  send: (type: string, payload: unknown, seq?: number) => void;
};

/** A user no other test spends from: the RateLimiter's storage lasts for the whole file. */
const drawer = () => `drawer-${crypto.randomUUID()}`;

// Each test gets its own Room (a fresh name): no drafts, sessions or alarms leak between tests.
let stub: DurableObjectStub<Room>;
let clients: Client[] = [];

beforeEach(() => {
  stub = env.ROOM.get(env.ROOM.idFromName(crypto.randomUUID()));
  clients = [];
  vi.setSystemTime(T0);
});

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  if (clients.length === 0) return;
  await evictDurableObject(stub, { webSockets: 'close' });
});

async function connect(userId: string): Promise<Client> {
  const upgrade = new Request('http://room/ws', { headers: { Upgrade: 'websocket' } });
  const res = await stub.fetch(withRoomUser(upgrade, { id: userId, name: userId.toUpperCase() }));
  expect(res.status).toBe(101);
  const ws = res.webSocket;
  if (!ws) throw new Error('expected a webSocket on the 101 response');
  let seq = 0;
  const client: Client = {
    ...socketClient(ws, (data) => FrameSchema.parse(JSON.parse(data))),
    userId,
    ws,
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

/** A `presence:set` round trip: every frame the Room sent `client` before it has arrived. */
async function barrier(client: Client): Promise<void> {
  const seen = client.of('presence').length;
  client.send('presence:set', { state: 'viewing' });
  await client.waitFor('presence', seen + 1);
}

const vertex = (i: number): [number, number] => [34.8 + i / 100, 32];
const add = (i: number): DraftOp => ({ op: 'add', index: i, vertex: vertex(i) });
const CLEAR: DraftOp = { op: 'clear' };
const adds = (n: number) => Array.from({ length: n }, (_, i) => add(i));

/** One `DRAFT_GAP_MS` later on the mocked clock, so the per-socket bucket never refuses. */
const tick = () => vi.setSystemTime(Date.now() + DRAFT_GAP_MS);

/**
 * Sends `ops` from `from`, one per tick, each awaited as `peer` receives its relay: the Room
 * stamps a frame's arrival time when it handles it, so an unawaited burst would arrive at once.
 */
async function draw(from: Client, peer: Client, ops: DraftOp[]): Promise<void> {
  for (const op of ops) {
    const relayed = peer.of('draft:update').length;
    tick();
    from.send('draft:update', op);
    await peer.waitFor('draft:update', relayed + 1);
  }
}

/** `userId` saved an area: the `area:created` the create route hands the Room (`fanout`). */
async function saved(userId: string): Promise<void> {
  const at = new Date().toISOString();
  const area: Area = {
    id: crypto.randomUUID(),
    name: 'saved draft',
    geometry: squareAt([34.8, 32]),
    areaKm2: 1,
    version: 1,
    createdBy: userId,
    createdAt: at,
    updatedAt: at,
  };
  await stub.broadcast({ type: 'area:created', payload: { area } });
}

/** `sessions` draft sessions by `from`: each an `add` that starts a draft, then its save. */
async function drawSessions(from: Client, peer: Client, sessions: number): Promise<void> {
  for (let i = 0; i < sessions; i++) {
    await draw(from, peer, [add(0)]);
    await saved(from.userId);
  }
}

const limiterOf = (userId: string) => env.RATE_LIMITER.get(env.RATE_LIMITER.idFromName(userId));
/** When each of the user's actions still in the window was spent, oldest first. */
const actionTimes = (userId: string) =>
  runInDurableObject(limiterOf(userId), (_limiter: RateLimiter, state) =>
    state.storage.sql
      .exec<{ ts: number }>('SELECT ts FROM actions ORDER BY ts')
      .toArray()
      .map(({ ts }) => ts),
  );
const actionsOf = async (userId: string) => (await actionTimes(userId)).length;
const draftRows = () =>
  runInDurableObject(stub, (_room, state) =>
    state.storage.sql
      .exec<{ user_id: string; vertices: string }>('SELECT user_id, vertices FROM drafts')
      .toArray(),
  );

describe('draft:update spends one drawing action per draft session (RateLimiter, D5)', () => {
  it(`${SESSION_FRAMES} frames in one session (more than the budget): all relayed, no RATE_LIMITED, one action spent`, async () => {
    const id = drawer();
    const a = await join(id);
    const b = await join('b');
    await draw(a, b, adds(SESSION_FRAMES));
    await barrier(a);
    expect(a.of('error')).toEqual([]);
    expect(await actionsOf(id)).toBe(1);
    const [row] = await draftRows();
    expect(JSON.parse(row?.vertices ?? '[]')).toHaveLength(SESSION_FRAMES);
  });

  it(`${DRAW_LIMIT + 1} sessions in a window: the ${DRAW_LIMIT + 1}st start gets error RATE_LIMITED (retryAfter ms, frameSeq) and the draft stays empty`, async () => {
    const id = drawer();
    const a = await join(id);
    const b = await join('b');
    await drawSessions(a, b, DRAW_LIMIT);
    expect(await actionsOf(id)).toBe(DRAW_LIMIT);

    tick();
    a.send('draft:update', add(0), REFUSED_SEQ);
    expect((await a.waitFor('error')).payload).toEqual({
      code: 'RATE_LIMITED',
      message: 'Too many requests',
      // Until the first session's action, DRAW_LIMIT ticks earlier, leaves the 60 s window.
      retryAfter: WINDOW_MS - DRAW_LIMIT * DRAFT_GAP_MS,
      frameSeq: REFUSED_SEQ,
    });
    await barrier(a);
    await barrier(b);
    expect(b.of('draft:update')).toHaveLength(DRAW_LIMIT);
    expect(await draftRows()).toEqual([]);
    expect(await actionsOf(id)).toBe(DRAW_LIMIT);
  });

  it('a refused start keeps the draft empty; after retryAfter the same add starts the session', async () => {
    const id = drawer();
    for (let i = 0; i < DRAW_LIMIT; i++) await limiterOf(id).take(ACTIONS.DRAW);
    const a = await join(id);
    const b = await join('b');
    a.send('draft:update', add(0), REFUSED_SEQ);
    const refused = await a.waitFor('error');
    expect(refused.payload).toEqual({
      code: 'RATE_LIMITED',
      message: 'Too many requests',
      retryAfter: WINDOW_MS,
      frameSeq: REFUSED_SEQ,
    });
    await barrier(b);
    expect(b.of('draft:update')).toEqual([]);
    expect(await draftRows()).toEqual([]);

    vi.setSystemTime(T0 + Number(refused.payload['retryAfter']));
    a.send('draft:update', add(0));
    expect((await b.waitFor('draft:update')).payload).toEqual({ ...add(0), userId: id });
    expect(await actionTimes(id)).toEqual([T0 + WINDOW_MS]);
  });

  it('a resync replay (clear, then one add per vertex) in the open session spends nothing; so does one from a new socket after a close', async () => {
    const id = drawer();
    const a = await join(id);
    const b = await join('b');
    await draw(a, b, [...adds(3), CLEAR, ...adds(3)]);
    expect(await actionsOf(id)).toBe(1);

    // The close drops the draft from everyone's view (D13); the session stays open.
    a.ws.close(1000, 'reconnecting');
    expect((await b.waitFor('draft:state', 2)).payload).toEqual({ drafts: [] });
    const a2 = await join(id);
    expect(a2.of('draft:state')[0]?.payload).toEqual({ drafts: [] });
    await draw(a2, b, [CLEAR, ...adds(3)]);
    await barrier(a2);
    expect(a2.of('error')).toEqual([]);
    expect(await actionsOf(id)).toBe(1);
    const c = await join('c');
    expect(c.of('draft:state')[0]?.payload).toEqual({
      drafts: [{ userId: id, vertices: [vertex(0), vertex(1), vertex(2)] }],
    });
  });

  it('hibernation between frames keeps the session open (it lives in the draft’s SQLite row)', async () => {
    const id = drawer();
    const a = await join(id);
    const b = await join('b');
    await draw(a, b, [add(0)]);
    await evictDurableObject(stub); // drops the instance, hibernates the sockets
    await draw(a, b, [add(1)]);
    await evictDurableObject(stub);
    await draw(a, b, [CLEAR, ...adds(2)]);
    await barrier(a);
    expect(a.of('error')).toEqual([]);
    expect(await actionsOf(id)).toBe(1);
  });

  it('a Room killed mid-session (sockets cut, no close event): the replay from the new socket spends nothing', async () => {
    const id = drawer();
    const a = await join(id);
    const b = await join('b');
    await draw(a, b, adds(2));
    const cut = clients.map((client) => client.closed);
    await evictDurableObject(stub, { webSockets: 'close' });
    await Promise.all(cut);
    clients = [];

    const a2 = await join(id);
    const b2 = await join('b');
    await draw(a2, b2, [CLEAR, ...adds(2)]);
    await barrier(a2);
    expect(a2.of('error')).toEqual([]);
    expect(await actionsOf(id)).toBe(1);
  });

  it('the drafter’s save ends the session: the next add spends again; another user’s save does not', async () => {
    const id = drawer();
    const a = await join(id);
    const b = await join('b');
    await draw(a, b, [add(0), CLEAR]);

    await saved('b');
    await draw(a, b, [add(0)]);
    expect(await actionsOf(id)).toBe(1);

    await saved(id);
    await draw(a, b, [add(0)]);
    expect(await actionsOf(id)).toBe(2);
  });

  it('a save while the draft is still on screen also drops it for everyone (draft:state)', async () => {
    const id = drawer();
    const a = await join(id);
    const b = await join('b');
    await draw(a, b, [add(0)]);
    await saved(id);
    expect((await b.waitFor('draft:state', 2)).payload).toEqual({ drafts: [] });
    expect(await draftRows()).toEqual([]);
    await barrier(a);
    expect(a.of('error')).toEqual([]);
  });

  it('the idle sweep ends the session: a cleared draft idle for WS.PRESENCE_IDLE_MS is gone (no draft:state, nothing on screen changed) and the next add spends again', async () => {
    const id = drawer();
    const a = await join(id);
    const b = await join('b');
    await draw(a, b, [add(0), CLEAR]);
    // An open session with nothing drawn: a row, but no draft anyone sees.
    expect(await draftRows()).toEqual([{ user_id: id, vertices: '[]' }]);
    const c = await join('c');
    expect(c.of('draft:state')[0]?.payload).toEqual({ drafts: [] });

    const sweptAt = Date.now() + WS.PRESENCE_IDLE_MS + 1;
    vi.setSystemTime(sweptAt);
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect(await draftRows()).toEqual([]);
    a.send('draft:update', add(0));
    await b.waitFor('draft:update', 3);
    expect(b.of('draft:state')).toHaveLength(1);
    // The first session's action has left the window; the new one was spent now.
    expect(await actionTimes(id)).toEqual([sweptAt]);
  });

  it('a frame dropped for its stale or repeated seq spends nothing, even an add that would start a session', async () => {
    const id = drawer();
    const a = await join(id);
    a.send('draft:update', add(0), 5);
    await barrier(a);
    await saved(id);
    a.send('draft:update', add(0), 5);
    a.send('draft:update', add(0), 4);
    await barrier(a);
    expect(await actionsOf(id)).toBe(1);
    expect(await draftRows()).toEqual([]);
  });
});

describe('the RateLimiter call, through the handler', () => {
  // Driven through the handler with a stand-in `takeDrawAction`: in this harness a rejected
  // DO-to-DO RPC is reported as an uncaught exception and the Room's eviction then hangs.
  async function drive(
    userId: string,
    takeDrawAction: RoomCtx['takeDrawAction'],
    frames: Array<[seq: number, op: DraftOp]>,
  ): Promise<void> {
    await runInDurableObject(stub, async (_room, state) => {
      const ws = state.getWebSockets().find((socket) => attachmentOf(socket)?.userId === userId);
      if (!ws) throw new Error('expected the drawer’s socket');
      const room = { ctx: state, drafts: new DraftStore(state.storage.sql), takeDrawAction };
      for (const [seq, op] of frames) {
        const attachment = attachmentOf(ws);
        if (!attachment) throw new Error('expected an attachment');
        tick();
        await draftUpdate(room, { ws, attachment }, seq, op, Date.now());
      }
    });
  }

  it('is made once per session: for the add that starts it, not for the ops after it', async () => {
    const id = drawer();
    const a = await join(id);
    const b = await join('b');
    const takeDrawAction = vi.fn<(userId: string) => Promise<TakeResult>>(async () => ({
      ok: true,
      remaining: 1,
    }));
    await drive(id, takeDrawAction, [
      [2, add(0)],
      [3, add(1)],
      [4, { op: 'move', index: 0, vertex: vertex(5) }],
      [5, { op: 'remove', index: 1 }],
      [6, CLEAR],
      [7, add(0)],
    ]);
    await b.waitFor('draft:update', 6);
    await barrier(a);
    expect(a.of('error')).toEqual([]);
    expect(takeDrawAction).toHaveBeenCalledExactlyOnceWith(id);
  });

  it('fails closed when the call fails: error INTERNAL to the sender, nothing relayed or stored, one log line', async () => {
    const id = drawer();
    const a = await join(id);
    const b = await join('b');
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const takeDrawAction = vi.fn<(userId: string) => Promise<TakeResult>>(async () => {
      throw new Error('limiter down');
    });
    await drive(id, takeDrawAction, [[2, add(0)]]);
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

describe('one budget with REST mutations', () => {
  let lane: Env;
  beforeAll(async () => {
    lane = await areasEnv();
  });

  const create = (user: User) =>
    areasClient(lane, user).create({ name: 'after drafting', geometry: squareAt(randomSpot()) });

  it(
    `a REST create after ${DRAW_LIMIT - 1} draft sessions is 201; after ${DRAW_LIMIT} it is 429`,
    async () => {
      const watcher = await join('b');
      const under = freshUser('drawer');
      await drawSessions(await join(under.id), watcher, DRAW_LIMIT - 1);
      expect((await create(under)).status).toBe(201);

      const over = freshUser('drawer');
      await drawSessions(await join(over.id), watcher, DRAW_LIMIT);
      const refused = await create(over);
      expect(refused.status).toBe(429);
      expect(await refused.json()).toMatchObject({ code: 'RATE_LIMITED' });
    },
    TEST.SLOW_TIMEOUT_MS * 2,
  );
});
