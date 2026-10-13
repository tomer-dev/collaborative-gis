// Test support for the Room tests (protocol.test.ts, protocol-lifecycle.test.ts,
// degradation.test.ts): a fresh Room per test and sockets that join it the way ws.ts does.
import { ROOM } from '@cgis/shared';
import { evictDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { expect, vi } from 'vitest';
import { z } from 'zod';
import { withRoomUser } from '../../src/do/handoff';
import type { Room } from '../../src/do/room';
import { socketClient } from './socket-client';

// Wire values (types, codes, payload shapes) are spelled out: they are the contract T8 and T14 use.

/** Any server frame; payloads are checked with toEqual/toMatchObject, so they stay unknown here. */
const FrameSchema = z.object({
  type: z.string(),
  seq: z.number(),
  ts: z.number(),
  payload: z.record(z.string(), z.unknown()),
});
export type Frame = z.infer<typeof FrameSchema>;

/** A test socket whose frames are parsed as `F` (`of`, `waitFor`: see socket-client.ts). */
export type Client<F extends { type: string } = Frame> = ReturnType<typeof socketClient<F>> & {
  userId: string;
  ws: WebSocket;
  send: (type: string, payload: unknown, seq?: number) => void;
};

// Timing-dependent tests freeze the clock with vi.setSystemTime: it mocks Date for the whole
// isolate, and the vitest plugin runs the Room in the test isolate, so the Room reads the same
// clock. T0 is far ahead of the real clock: workerd schedules alarms on real time, so an alarm
// armed at a mocked instant in the past would fire mid-test; these tests run alarms with
// runDurableObjectAlarm (see rate-limit/rate-limiter.test.ts).
export const T0 = Date.UTC(2100, 0, 1);

/** An explicit `seq` for a frame the Room will refuse, so its `error` can be matched to it. */
export const REFUSED_SEQ = 1000;

/**
 * A user id no other test spends from. Every draft session spends from the user's RateLimiter
 * (D5; draft-session.test.ts), whose storage lasts for the whole file; a test that drafts on a
 * mocked clock leaves actions dated T0 that the real clock never prunes.
 */
export const drawer = () => `drawer-${crypto.randomUUID()}`;

// Each test gets its own Room (a fresh name): no drafts, counters or alarms leak between tests.
/** The current test's Room: a live binding, set by `newRoom` (beforeEach). */
export let stub: DurableObjectStub<Room>;
let clients: { closed: Promise<CloseEvent> }[] = [];

/** beforeEach: a Room under a fresh name, no sockets yet. */
export function newRoom(): void {
  stub = env.ROOM.get(env.ROOM.idFromName(crypto.randomUUID()));
  clients = [];
}

/** afterEach: real timers and mocks back, and the test's sockets closed. */
export async function closeRoom(): Promise<void> {
  vi.useRealTimers();
  vi.restoreAllMocks();
  if (clients.length === 0) return;
  // Eviction waits for in-flight requests; closing the sockets keeps them from outliving the test.
  await evictDurableObject(stub, { webSockets: 'close' });
}

/** `connect` and `join` for sockets whose frames `parse` reads. */
export function socketsParsedWith<F extends { type: string }>(parse: (data: string) => F) {
  /** Opens a socket the way ws.ts does: straight to the Room, the user in the hand-off headers. */
  async function connect(userId: string, name = userId.toUpperCase()): Promise<Client<F>> {
    const upgrade = new Request('http://room/ws', { headers: { Upgrade: 'websocket' } });
    const res = await stub.fetch(withRoomUser(upgrade, { id: userId, name }));
    expect(res.status).toBe(101);
    const ws = res.webSocket;
    if (!ws) throw new Error('expected a webSocket on the 101 response');

    let seq = 0;
    const client: Client<F> = {
      userId,
      ws,
      ...socketClient(ws, parse),
      send(type, payload, explicitSeq) {
        seq = explicitSeq ?? seq + 1;
        ws.send(JSON.stringify({ type, seq, ts: Date.now(), payload }));
      },
    };
    clients.push(client);
    return client;
  }

  /** Connects and joins; resolves once the joiner has its presence and draft:state replies. */
  async function join(userId: string, name?: string): Promise<Client<F>> {
    const client = await connect(userId, name);
    client.send('join', { mapId: ROOM.DEFAULT_ROOM_ID });
    await client.waitFor('draft:state');
    return client;
  }

  return { connect, join };
}

/** Sockets whose frames are any `Frame`, payloads checked with toEqual/toMatchObject. */
export const { connect, join } = socketsParsedWith((data) => FrameSchema.parse(JSON.parse(data)));

/**
 * Kills the Room the way a crash or a deploy does: the instance is dropped and every socket is
 * cut (the peers see 1006; the Room gets no close event). Storage stays.
 */
export async function kill(): Promise<void> {
  const cut = clients.map((client) => client.closed);
  await evictDurableObject(stub, { webSockets: 'close' });
  await Promise.all(cut);
  clients = [];
}

/**
 * Frames to one socket arrive in order. A `presence:set` round trip is a barrier: once `client`
 * has the presence it triggers, every frame the Room sent it earlier has arrived.
 */
export async function barrier(client: {
  of: (type: 'presence') => unknown[];
  waitFor: (type: 'presence', count: number) => Promise<unknown>;
  send: (type: string, payload: unknown) => void;
}): Promise<void> {
  const seen = client.of('presence').length;
  client.send('presence:set', { state: 'viewing' });
  await client.waitFor('presence', seen + 1);
}

export const users = (frame: Frame) => frame.payload['users'];
export const vertex = (i: number): [number, number] => [34.8 + i / 100, 32];
export const add = (i: number) => ({ op: 'add', index: i, vertex: vertex(i) });
