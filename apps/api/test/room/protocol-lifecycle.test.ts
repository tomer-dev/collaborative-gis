import { ROOM, WS } from '@cgis/shared';
import { evictDurableObject, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { attachmentOf } from '../../src/do/presence';
import { Room } from '../../src/do/room';
import {
  add,
  barrier,
  closeRoom,
  connect,
  drawer,
  join,
  newRoom,
  stub,
  T0,
  users,
} from './protocol-harness';

// The Room protocol across hibernation, the alarm and idle sweep, and the per-user frame queue.
// The frames themselves are in protocol.test.ts.
beforeEach(newRoom);
afterEach(closeRoom);

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

describe('frame order while a draft:update waits on the RateLimiter', () => {
  it('a leave right behind a session-starting draft:update is handled after it: the draft is relayed, then dropped', async () => {
    const id = drawer();
    const a = await join(id);
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
    // Dropped from view; the draw session stays open (D5, draft-session.test.ts).
    const rows = await runInDurableObject(stub, (_room, state) =>
      state.storage.sql.exec('SELECT user_id, vertices FROM drafts').toArray(),
    );
    expect(rows).toEqual([{ user_id: id, vertices: '[]' }]);
  });
});
