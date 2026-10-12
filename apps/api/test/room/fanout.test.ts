import { type AreaEvent, AreaSchema, parseWsMessage, ROOM, ROUTES } from '@cgis/shared';
import {
  createExecutionContext,
  evictDurableObject,
  runInDurableObject,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../src/app';
import { Room } from '../../src/do/room';
import { areasClient, areasEnv, freshUser, randomSpot, squareAt } from '../areas/fixtures';
import { appWithUser, type User } from '../helpers';
import { socketClient } from './socket-client';

// TOM-37: a committed area change reaches every socket in the Room, after the HTTP response.
// Wire values (types, statuses, log fields) are spelled out: they are the contract T14 relies on.

/** How long the "response does not wait" test gives a response before releasing the broadcast. */
const RESPONSE_PATIENCE_MS = 2000;

let env: Env;
beforeAll(async () => {
  env = await areasEnv();
});

const room = () => env.ROOM.get(env.ROOM.idFromName(ROOM.DEFAULT_ROOM_ID));
const socketCount = () =>
  runInDurableObject(room(), (_room, state) => state.getWebSockets().length);

afterEach(async () => {
  vi.restoreAllMocks();
  // Storage is per test file, so the default Room outlives a test: close its sockets between tests.
  if ((await socketCount()) > 0) await evictDurableObject(room(), { webSockets: 'close' });
});

/**
 * Opens a socket through the Worker's real `GET /ws` (session user, browser Origin), sends `join`
 * and waits for the join reply. Every frame is parsed with the shared envelope schema.
 */
async function joined(user: User) {
  const res = await appWithUser(user).request(
    ROUTES.WS,
    { headers: { Upgrade: 'websocket', Origin: env.CLIENT_ORIGIN } },
    env,
  );
  expect(res.status).toBe(101);
  const ws = res.webSocket;
  if (!ws) throw new Error('expected a webSocket on the 101 response');
  const socket = socketClient(ws, parseWsMessage);
  ws.send(
    JSON.stringify({
      type: 'join',
      seq: 1,
      ts: Date.now(),
      payload: { mapId: ROOM.DEFAULT_ROOM_ID },
    }),
  );
  await socket.waitFor('draft:state');
  return socket;
}

const newSquare = () => ({ name: 'Fan-out field', geometry: squareAt(randomSpot()) });

/** Creates an area through `POST /api/areas` as `user` and returns the 201 body. */
async function createArea(user: User) {
  const res = await areasClient(env, user).create(newSquare());
  expect(res.status).toBe(201);
  return AreaSchema.parse(await res.json());
}

/**
 * `env` with a stand-in `ROOM` for the namespace calls a mutation makes: `idFromName`, then
 * `get(...).bumpVersion` before the response (`bumpVersion`, default: answers 1) and
 * `get(...).broadcast` in `waitUntil` (`broadcast`). POST reaches the Room only through `publish`.
 * Test-only: production code has no switch to make the Room fail.
 */
const withRoom = (
  broadcast: (event: AreaEvent, mapVersion?: number) => Promise<void>,
  bumpVersion: () => Promise<number> = async () => 1,
) => ({
  ...env,
  ROOM: { idFromName: () => ({}), get: () => ({ broadcast, bumpVersion }) },
});

describe('fan-out from the area routes', () => {
  it('POST: a joined socket receives area:created with the 201 area, seq, ts and mapVersion', async () => {
    const before = (await room().getVersion()).version;
    const user = freshUser();
    const socket = await joined(user);
    const area = await createArea(user);
    const frame = await socket.waitFor('area:created');
    expect(frame).toEqual({
      type: 'area:created',
      payload: { area },
      seq: expect.any(Number),
      ts: expect.any(Number),
      // Presence and draft:state frames from the join advance seq, not the map version.
      mapVersion: before + 1,
    });
    expect(frame.payload.area.id).toBe(area.id);
    expect((await room().getVersion()).version).toBe(before + 1);
  });

  it('every socket receives the change, the author’s included, as the same frame', async () => {
    const [a, b] = [freshUser('a'), freshUser('b')];
    const [socketA, socketB] = [await joined(a), await joined(b)];
    const area = await createArea(a);
    const [gotA, gotB] = [
      await socketA.waitFor('area:created'),
      await socketB.waitFor('area:created'),
    ];
    expect(gotA.payload).toEqual({ area });
    expect(gotB).toEqual(gotA);
  });

  it('PUT sends area:updated with the new version; DELETE sends area:deleted { id }', async () => {
    const user = freshUser();
    const socket = await joined(user);
    const api = areasClient(env, user);
    const before = (await room().getVersion()).version;
    const area = await createArea(user);
    const put = await api.update(area.id, {
      name: 'Renamed',
      geometry: area.geometry,
      version: area.version,
    });
    expect(put.status).toBe(200);
    const updated = AreaSchema.parse(await put.json());
    expect(updated.version).toBe(2);
    const del = await api.remove(area.id);
    expect(del.status).toBe(204);

    const [created, changed, deleted] = [
      await socket.waitFor('area:created'),
      await socket.waitFor('area:updated'),
      await socket.waitFor('area:deleted'),
    ];
    expect(changed.payload).toEqual({ area: updated });
    expect(deleted.payload).toEqual({ id: area.id });
    // One map version per committed change, in commit order; seq keeps rising with them.
    expect([created, changed, deleted].map((f) => f.mapVersion)).toEqual([
      before + 1,
      before + 2,
      before + 3,
    ]);
    expect(changed.seq).toBeGreaterThan(created.seq);
    expect(deleted.seq).toBeGreaterThan(changed.seq);
  });

  it('a refused mutation (409, 404) sends nothing and leaves the map version alone', async () => {
    const user = freshUser();
    const socket = await joined(user);
    const api = areasClient(env, user);
    const area = await createArea(user);
    await socket.waitFor('area:created');
    const version = (await room().getVersion()).version;

    const stale = await api.update(area.id, { name: 'Late', geometry: area.geometry, version: 99 });
    expect(stale.status).toBe(409);
    await stale.body?.cancel();
    const missing = await api.remove(crypto.randomUUID());
    expect(missing.status).toBe(404);
    await missing.body?.cancel();

    expect((await room().getVersion()).version).toBe(version);
    // A later change is the next frame after area:created: nothing was sent in between.
    await api.remove(area.id);
    await socket.waitFor('area:deleted');
    const areaFrames = socket.frames.filter((f) => f.type.startsWith('area:'));
    expect(areaFrames.map((f) => f.type)).toEqual(['area:created', 'area:deleted']);
  });

  it('the response does not wait for the broadcast', async () => {
    let release = () => {};
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const order: string[] = [];
    const slow = withRoom(async () => {
      order.push('broadcast called');
      await released;
      order.push('broadcast settled');
    });
    const ctx = createExecutionContext();
    const response = areasClient(slow, freshUser(), {}, ctx)
      .create(newSquare())
      .then((res) => {
        order.push('response');
        return res;
      });
    // Bounded, so a route that awaited the broadcast fails on `order` instead of hanging.
    await Promise.race([response, scheduler.wait(RESPONSE_PATIENCE_MS)]);
    release();
    const res = await response;
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(201);
    await res.body?.cancel();
    expect(order).toEqual(['broadcast called', 'response', 'broadcast settled']);
  });

  it('a Room that rejects: still 201, one error log line, nothing thrown into waitUntil', async () => {
    const failing = withRoom(async () => {
      throw new Error('room unavailable');
    });
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const ctx = createExecutionContext();
    const res = await areasClient(failing, freshUser(), {}, ctx).create(newSquare());
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(201);
    const area = AreaSchema.parse(await res.json());
    expect(logged).toHaveBeenCalledOnce();
    expect(JSON.parse(String(logged.mock.calls[0]?.[0]))).toEqual({
      level: 'error',
      msg: 'fanout failed',
      requestId: res.headers.get('x-request-id'),
      type: 'area:created',
      areaId: area.id,
      error: expect.stringContaining('room unavailable'),
    });
  });

  it('the bump before the response hands its version to the broadcast', async () => {
    const broadcast = vi.fn<(event: AreaEvent, mapVersion?: number) => Promise<void>>(
      async () => {},
    );
    const ctx = createExecutionContext();
    const res = await areasClient(
      withRoom(broadcast, async () => 41),
      freshUser(),
      {},
      ctx,
    ).create(newSquare());
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(201);
    const area = AreaSchema.parse(await res.json());
    expect(broadcast).toHaveBeenCalledExactlyOnceWith(
      { type: 'area:created', payload: { area } },
      41,
    );
  });

  it('a bump that fails: still 201, one error log line, and the broadcast bumps instead', async () => {
    const broadcast = vi.fn<(event: AreaEvent, mapVersion?: number) => Promise<void>>(
      async () => {},
    );
    const failing = withRoom(broadcast, async () => {
      throw new Error('room unavailable');
    });
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const ctx = createExecutionContext();
    const res = await areasClient(failing, freshUser(), {}, ctx).create(newSquare());
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(201);
    const area = AreaSchema.parse(await res.json());
    expect(logged).toHaveBeenCalledOnce();
    expect(JSON.parse(String(logged.mock.calls[0]?.[0]))).toEqual({
      level: 'error',
      msg: 'version bump failed',
      requestId: res.headers.get('x-request-id'),
      error: expect.stringContaining('room unavailable'),
    });
    expect(broadcast).toHaveBeenCalledExactlyOnceWith(
      { type: 'area:created', payload: { area } },
      undefined,
    );
  });
});

describe('Room.broadcast and Room.getVersion (RPC)', () => {
  const deleted = (n: number): AreaEvent => ({
    type: 'area:deleted',
    payload: { id: `00000000-0000-4000-8000-00000000000${n}` },
  });

  it('getVersion() starts at 0, rises by one per broadcast, and survives a fresh instance', async () => {
    const stub = env.ROOM.get(env.ROOM.idFromName(crypto.randomUUID()));
    expect((await stub.getVersion()).version).toBe(0);
    await stub.broadcast(deleted(1));
    expect((await stub.getVersion()).version).toBe(1);
    await stub.broadcast(deleted(2));
    expect((await stub.getVersion()).version).toBe(2);

    // A new Room on the same storage reads the persisted counter...
    const fresh = await runInDurableObject(stub, (_room, state) =>
      new Room(state, env).getVersion(),
    );
    expect(fresh.version).toBe(2);
    // ...and so does the next instance after this one is evicted.
    await evictDurableObject(stub);
    expect((await stub.getVersion()).version).toBe(2);
    await stub.broadcast(deleted(3));
    expect((await stub.getVersion()).version).toBe(3);
  });

  it('rejects an invalid event: logged, not sent, version unchanged, never thrown', async () => {
    const socket = await joined(freshUser());
    const before = (await room().getVersion()).version;
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const invalid: AreaEvent = { type: 'area:deleted', payload: { id: 'not-a-uuid' } };
    const call = async () => room().broadcast(invalid);
    await expect(call()).resolves.toBeUndefined();
    expect(logged).toHaveBeenCalledOnce();
    expect(JSON.parse(String(logged.mock.calls[0]?.[0]))).toEqual({
      level: 'error',
      msg: 'room broadcast rejected an invalid event',
      issues: expect.stringContaining('id'),
    });
    expect((await room().getVersion()).version).toBe(before);

    // The next valid change is the first area frame the socket sees, at the next version.
    await room().broadcast(deleted(4));
    const frame = await socket.waitFor('area:deleted');
    expect(frame).toMatchObject({ payload: deleted(4).payload, mapVersion: before + 1 });
    expect(socket.frames.filter((f) => f.type.startsWith('area:'))).toHaveLength(1);
  });
});
