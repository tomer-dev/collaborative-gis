import type { AreaEvent } from '@cgis/shared';
import { evictDurableObject, runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { Room } from '../../src/do/room';

// D6: the map version the M2 viewport cache keys on. A fresh Room per test: no counter is shared.
const freshRoom = () => env.ROOM.get(env.ROOM.idFromName(crypto.randomUUID()));
const deleted = (): AreaEvent => ({ type: 'area:deleted', payload: { id: crypto.randomUUID() } });

describe('Room map version: getVersion / bumpVersion (RPC)', () => {
  it('bumpVersion() adds one and returns the new version', async () => {
    const room = freshRoom();
    expect(await room.bumpVersion()).toBe(1);
    expect(await room.bumpVersion()).toBe(2);
    expect(await room.getVersion()).toBe(2);
  });

  it('a broadcast handed the version its route already bumped does not bump again', async () => {
    const room = freshRoom();
    const bumped = await room.bumpVersion();
    await room.broadcast(deleted(), bumped);
    expect(await room.getVersion()).toBe(1);
  });

  it('a broadcast without a version (the route’s bump failed) bumps the counter exactly once', async () => {
    const room = freshRoom();
    await room.broadcast(deleted());
    expect(await room.getVersion()).toBe(1);
    expect(await room.bumpVersion()).toBe(2);
    await room.broadcast(deleted());
    await room.broadcast(deleted());
    expect(await room.getVersion()).toBe(4);
  });

  it('survives a restart: eviction and a fresh instance on the same storage', async () => {
    const room = freshRoom();
    await room.bumpVersion();
    await room.broadcast(deleted());
    await evictDurableObject(room);
    expect(await room.getVersion()).toBe(2);
    const bumped = await runInDurableObject(room, (_room, state) =>
      new Room(state, env).bumpVersion(),
    );
    expect(bumped).toBe(3);
    expect(await room.getVersion()).toBe(3);
  });
});
