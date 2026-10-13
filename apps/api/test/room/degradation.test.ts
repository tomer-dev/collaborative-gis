import { ROOM, WS, parseWsMessage } from '@cgis/shared';
import { evictDurableObject, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DraftStore } from '../../src/do/drafts';
import {
  barrier,
  closeRoom,
  kill,
  newRoom,
  socketsParsedWith,
  stub,
  T0,
  vertex,
} from './protocol-harness';

// Graceful degradation, server half (spec §5 "Degradation", §6): what a client sees when the Room
// is killed or loses its state, and the `resync: true` errors that tell it to rebuild. Frames are
// parsed with the shared schema, so a field the schema lacks (`resync`) would be stripped here.

const SECOND = 1000;

beforeEach(newRoom);
afterEach(closeRoom);

const { join: joinAs } = socketsParsedWith(parseWsMessage);
type Client = Awaited<ReturnType<typeof joinAs>>;
type User = { id: string; name: string };

/**
 * A user no other test spends from: every draft session spends from the user's RateLimiter (D5),
 * whose storage lasts for the whole file. Presence sorts by name.
 */
const user = (name: string): User => ({ id: `${name}-${crypto.randomUUID()}`, name });
const join = (who: User) => joinAs(who.id, who.name);

/** Drops all of the Room's storage while its sockets stay attached, then starts a fresh instance. */
async function loseState(): Promise<void> {
  await runInDurableObject(stub, (_room, state) => state.storage.deleteAll());
  await evictDurableObject(stub); // sockets hibernate: they outlive the state they joined
}

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
    expect(userIds(c, 'presence')).toEqual([A.id, B.id, c.userId]);
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

describe('a Room that lost its storage under attached sockets', () => {
  it('a join on the same socket re-arms the sweep and gets the (now empty) draft:state', async () => {
    const a = await join(user('A'));
    a.send('draft:update', add(0));
    await barrier(a);
    await loseState();
    expect(await alarmOf()).toBeNull(); // deleteAll took the alarm too

    a.send('join', { mapId: ROOM.DEFAULT_ROOM_ID });
    expect((await a.waitFor('draft:state', 2)).payload).toEqual({ drafts: [] });
    expect(await alarmOf()).toEqual(expect.any(Number));
  });
});

describe('error events carry resync: true when the Room lost state', () => {
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
