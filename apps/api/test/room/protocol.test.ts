import { ROOM, WS } from '@cgis/shared';
import { evictDurableObject, runInDurableObject } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { attachmentOf } from '../../src/do/presence';
import {
  add,
  barrier,
  closeRoom,
  connect,
  drawer,
  join,
  newRoom,
  REFUSED_SEQ,
  stub,
  T0,
  users,
  vertex,
} from './protocol-harness';

// The frames of the Room protocol. Hibernation, the alarm and idle sweep, and frame order are in
// protocol-lifecycle.test.ts.
beforeEach(newRoom);
afterEach(closeRoom);

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
    // Frozen clock: every frame arrives at T0, so the socket's window cannot roll over mid-burst
    // however long the Room (or a loaded machine) takes to handle them.
    vi.setSystemTime(T0);
    const a = await join(drawer());
    const b = await join('b');
    for (let i = 0; i < WS.DRAFT_RATE_PER_SEC; i++) a.send('draft:update', add(i));
    a.send('draft:update', add(WS.DRAFT_RATE_PER_SEC), REFUSED_SEQ);
    const error = await a.waitFor('error');
    expect(error.payload).toEqual({
      code: 'RATE_LIMITED',
      message: 'Too many requests',
      // The rest of the window: every frame arrived at T0, so the whole second.
      retryAfter: 1000,
      // The refused frame's own seq: the client takes that op back and sends it again.
      frameSeq: REFUSED_SEQ,
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
