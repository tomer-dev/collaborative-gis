import { ROOM, WS, type WsEvent, parseWsMessage } from '@cgis/shared';
import { evictDurableObject, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DraftStore } from '../../src/do/drafts';
import { withRoomUser } from '../../src/do/handoff';
import type { RateLimiter } from '../../src/do/rate-limiter';
import type { Room } from '../../src/do/room';
import { socketClient } from './socket-client';

// Graceful degradation, server half (spec §5 "Degradation", §6): what a client sees when the Room
// is killed or loses its state, and the `resync: true` errors that tell it to rebuild. Frames are
// parsed with the shared schema, so a field the schema lacks (`resync`) would be stripped here.

type User = { id: string; name: string };
type Client = ReturnType<typeof socketClient<WsEvent>> & {
  user: User;
  ws: WebSocket;
  send: (type: string, payload: unknown) => void;
};

// Frozen-clock tests: see protocol.test.ts. T0 is far ahead of the real clock so that an alarm
// armed at a mocked instant never fires on its own; the tests run alarms with runDurableObjectAlarm.
const T0 = Date.UTC(2100, 0, 1);
const SECOND = 1000;

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
  await evictDurableObject(stub, { webSockets: 'close' });
});

/**
 * A user no other test spends from: every draft session spends from the user's RateLimiter (D5),
 * whose storage lasts for the whole file. Presence sorts by name.
 */
const user = (name: string): User => ({ id: `${name}-${crypto.randomUUID()}`, name });

async function connect(who: User): Promise<Client> {
  const upgrade = new Request('http://room/ws', { headers: { Upgrade: 'websocket' } });
  const res = await stub.fetch(withRoomUser(upgrade, who));
  expect(res.status).toBe(101);
  const ws = res.webSocket;
  if (!ws) throw new Error('expected a webSocket on the 101 response');
  let seq = 0;
  const client: Client = {
    ...socketClient(ws, parseWsMessage),
    user: who,
    ws,
    send(type, payload) {
      seq += 1;
      ws.send(JSON.stringify({ type, seq, ts: Date.now(), payload }));
    },
  };
  clients.push(client);
  return client;
}

/** Connects and joins once; resolves with the join's draft:state reply in. */
async function join(who: User): Promise<Client> {
  const client = await connect(who);
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

/**
 * Kills the Room the way a crash or a deploy does: the instance is dropped and every socket is
 * cut (the peers see 1006; the Room gets no close event). Storage stays.
 */
async function kill(): Promise<void> {
  const cut = clients.map((client) => client.closed);
  await evictDurableObject(stub, { webSockets: 'close' });
  await Promise.all(cut);
  clients = [];
}

/** Drops all of the Room's storage while its sockets stay attached, then starts a fresh instance. */
async function loseState(): Promise<void> {
  await runInDurableObject(stub, (_room, state) => state.storage.deleteAll());
  await evictDurableObject(stub); // sockets hibernate: they outlive the state they joined
}

const vertex = (i: number): [number, number] => [34.8 + i / 100, 32];
const add = (index: number, i = index) => ({ op: 'add', index, vertex: vertex(i) });
const userIds = (client: Client, type: 'presence' | 'draft:state', n = 1) => {
  const frame = client.of(type)[n - 1];
  if (frame?.type === 'presence') return frame.payload.users.map((u) => u.userId);
  if (frame?.type === 'draft:state') return frame.payload.drafts.map((d) => d.userId);
  throw new Error(`expected ${type} #${n}`);
};
const draftRows = () =>
  runInDurableObject(stub, (_room, state) =>
    state.storage.sql.exec('SELECT user_id FROM drafts').toArray(),
  );
const alarmOf = () => runInDurableObject(stub, (_room, state) => state.storage.getAlarm());
const actionsOf = (userId: string) =>
  runInDurableObject(
    env.RATE_LIMITER.get(env.RATE_LIMITER.idFromName(userId)),
    (_limiter: RateLimiter, state) =>
      state.storage.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM actions').one().n,
  );

const STATE_LOST = { code: 'CONFLICT', message: 'room state lost; join again', resync: true };

describe('join after a reconnect', () => {
  it('a second join on a new socket of the same user receives the full draft:state and the current presence, each user once', async () => {
    vi.setSystemTime(T0);
    const A = user('A');
    const B = user('B');
    const a1 = await join(A);
    const b = await join(B);
    a1.send('draft:update', add(0));
    a1.send('draft:update', add(1));
    await b.waitFor('draft:update', 2);
    vi.setSystemTime(T0 + SECOND);
    b.send('draft:update', add(0, 5));
    await a1.waitFor('draft:update');

    // The reconnect opens a2 before the Room has noticed that a1 is gone.
    const a2 = await join(A);
    expect(a2.frames.map((frame) => frame.type)).toEqual(['presence', 'draft:state']);
    const [presence] = a2.of('presence');
    expect(presence?.payload.users).toEqual([
      expect.objectContaining({ userId: A.id, name: 'A' }),
      expect.objectContaining({ userId: B.id, name: 'B' }),
    ]);
    expect(a2.of('draft:state')[0]?.payload.drafts).toEqual([
      { userId: A.id, vertices: [vertex(0), vertex(1)] },
      { userId: B.id, vertices: [vertex(5)] },
    ]);
  });
});

describe('chaos: the Room is killed mid-draft', () => {
  it('two users mid-draft, Room killed: one join each after the reconnect returns both surviving drafts; resending them leaves one ghost per user', async () => {
    vi.setSystemTime(T0);
    const A = user('A');
    const B = user('B');
    const a = await join(A);
    const b = await join(B);
    a.send('draft:update', add(0));
    a.send('draft:update', add(1));
    await b.waitFor('draft:update', 2);
    vi.setSystemTime(T0 + SECOND);
    b.send('draft:update', add(0, 5));
    await a.waitFor('draft:update');

    await kill();
    // Drafts are in the Room's SQLite storage: the kill does not take them.
    expect(await draftRows()).toHaveLength(2);

    vi.setSystemTime(T0 + 2 * SECOND);
    const a2 = await join(A);
    const b2 = await join(B);
    const surviving = [
      { userId: A.id, vertices: [vertex(0), vertex(1)] },
      { userId: B.id, vertices: [vertex(5)] },
    ];
    expect(a2.of('draft:state').map((frame) => frame.payload.drafts)).toEqual([surviving]);
    expect(b2.of('draft:state').map((frame) => frame.payload.drafts)).toEqual([surviving]);
    expect(userIds(b2, 'presence')).toEqual([A.id, B.id]);
    expect(userIds(a2, 'presence', 2)).toEqual([A.id, B.id]);

    // The client contract: after a (re)join, resend the local draft as clear + adds.
    a2.send('draft:update', { op: 'clear' });
    a2.send('draft:update', add(0));
    a2.send('draft:update', add(1));
    b2.send('draft:update', { op: 'clear' });
    b2.send('draft:update', add(0, 5));
    await b2.waitFor('draft:update', 3);
    await a2.waitFor('draft:update', 2);
    expect(a2.of('error')).toEqual([]);
    expect(b2.of('error')).toEqual([]);

    const c = await join(user('C'));
    expect(c.of('draft:state')[0]?.payload.drafts).toEqual(surviving);
    expect(userIds(c, 'presence')).toEqual([A.id, B.id, c.user.id]);
  });

  it('killed with the sockets hibernated (a fresh instance, sockets still attached): drafting goes on, no resync', async () => {
    const A = user('A');
    const B = user('B');
    const a = await join(A);
    const b = await join(B);
    a.send('draft:update', add(0));
    await b.waitFor('draft:update');
    await evictDurableObject(stub);
    a.send('draft:update', add(1));
    expect((await b.waitFor('draft:update', 2)).payload).toEqual({ ...add(1), userId: A.id });
    await barrier(a);
    await barrier(b);
    expect([...a.of('error'), ...b.of('error')]).toEqual([]);
    const c = await join(user('C'));
    expect(c.of('draft:state')[0]?.payload.drafts).toEqual([
      { userId: A.id, vertices: [vertex(0), vertex(1)] },
    ]);
  });

  it('a draft whose user never comes back is dropped at WS.PRESENCE_IDLE_MS even with no socket left', async () => {
    vi.setSystemTime(T0);
    const a = await join(user('A'));
    a.send('draft:update', add(0));
    await barrier(a);
    await kill();

    vi.setSystemTime(T0 + WS.ALARM_INTERVAL_MS);
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect(await draftRows()).toHaveLength(1);
    // No socket is open, but a draft is still waiting to expire: the sweep re-arms.
    expect(await alarmOf()).toBe(T0 + 2 * WS.ALARM_INTERVAL_MS);

    vi.setSystemTime(T0 + WS.PRESENCE_IDLE_MS + SECOND);
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect(await draftRows()).toEqual([]);
    expect(await alarmOf()).toBeNull();
  });
});

describe('error events carry resync: true when the Room lost state', () => {
  it('storage lost under attached sockets: each joined socket’s next frame gets error CONFLICT resync and is dropped (not relayed, stored or charged)', async () => {
    const A = user('A');
    const B = user('B');
    const a = await join(A);
    const b = await join(B);
    a.send('draft:update', add(0));
    await b.waitFor('draft:update');

    await loseState();
    a.send('draft:update', add(1));
    expect((await a.waitFor('error')).payload).toEqual(STATE_LOST);
    b.send('presence:set', { state: 'drawing' });
    expect((await b.waitFor('error')).payload).toEqual(STATE_LOST);

    expect(b.of('draft:update')).toHaveLength(1);
    expect(b.of('presence')).toHaveLength(1);
    expect(await draftRows()).toEqual([]);
    expect(await actionsOf(A.id)).toBe(1);
  });

  it('join again on the same socket: presence and the (now empty) draft:state, the sweep re-armed, frames accepted; a socket that has not re-joined is still told', async () => {
    const A = user('A');
    const B = user('B');
    const a = await join(A);
    const b = await join(B);
    b.send('draft:update', add(0, 5));
    await a.waitFor('draft:update');
    await loseState();
    expect(await alarmOf()).toBeNull(); // deleteAll took the alarm too

    a.send('presence:set', { state: 'drawing' });
    await a.waitFor('error');
    a.send('join', { mapId: ROOM.DEFAULT_ROOM_ID });
    expect((await a.waitFor('draft:state', 2)).payload).toEqual({ drafts: [] });
    expect(userIds(a, 'presence', a.of('presence').length)).toEqual([A.id, B.id]);
    expect(await alarmOf()).toEqual(expect.any(Number));

    a.send('draft:update', add(0));
    expect((await b.waitFor('draft:update')).payload).toEqual({ ...add(0), userId: A.id });
    await barrier(a);
    expect(a.of('error')).toHaveLength(1);

    b.send('draft:update', add(1, 6));
    expect((await b.waitFor('error')).payload).toEqual(STATE_LOST);
    b.send('join', { mapId: ROOM.DEFAULT_ROOM_ID });
    expect((await b.waitFor('draft:state', 2)).payload).toEqual({
      drafts: [{ userId: A.id, vertices: [vertex(0)] }],
    });
  });

  it('a draft:update on a draft the Room no longer has (dropped by the 60 s sweep): DRAFT_OP_MISFIT with resync: true', async () => {
    vi.setSystemTime(T0);
    const a = await join(user('A'));
    const b = await join(user('B'));
    a.send('draft:update', add(0));
    a.send('draft:update', add(1));
    await b.waitFor('draft:update', 2);
    vi.setSystemTime(T0 + WS.PRESENCE_IDLE_MS + SECOND);
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect((await b.waitFor('draft:state', 2)).payload).toEqual({ drafts: [] });

    a.send('draft:update', { op: 'move', index: 1, vertex: vertex(7) });
    expect((await a.waitFor('error')).payload).toEqual({
      code: 'DRAFT_OP_MISFIT',
      message: 'draft op does not fit the current draft',
      resync: true,
    });
  });

  it('§6: a storage failure while handling a frame: error INTERNAL resync to the sender, one log line, the socket stays open', async () => {
    const a = await join(user('A'));
    const b = await join(user('B'));
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(DraftStore.prototype, 'write').mockImplementation(() => {
      throw new Error('SQLITE_FULL');
    });
    a.send('draft:update', add(0));
    expect((await a.waitFor('error')).payload).toEqual({
      code: 'INTERNAL',
      message: 'Internal Server Error',
      resync: true,
    });
    await barrier(a);
    await barrier(b);
    expect(b.of('draft:update')).toEqual([]);
    expect(logged).toHaveBeenCalledOnce();
    expect(JSON.parse(String(logged.mock.calls[0]?.[0]))).toEqual({
      level: 'error',
      msg: 'room frame failed',
      type: 'draft:update',
      stack: expect.stringContaining('SQLITE_FULL'),
    });
  });
});
