import { ROOM } from '@cgis/shared';
import { evictDurableObject, runInDurableObject } from 'cloudflare:test';
import { env, withEnv } from 'cloudflare:workers';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { Env } from '../../src/app';
import { type DraftOp, DraftStore } from '../../src/do/drafts';
import { draftUpdate } from '../../src/do/handlers';
import { withRoomUser } from '../../src/do/handoff';
import { attachmentOf } from '../../src/do/presence';
import type { Room } from '../../src/do/room';
import { socketClient } from '../room/socket-client';
import { auditEnv, auditRowsWhere } from './fixtures';

let lane: Env;
beforeAll(async () => {
  lane = await auditEnv();
});

// Each test gets its own Room, so no drafts leak between tests.
let stub: DurableObjectStub<Room>;
beforeEach(() => {
  stub = env.ROOM.get(env.ROOM.idFromName(crypto.randomUUID()));
});

afterEach(async () => {
  await evictDurableObject(stub, { webSockets: 'close' });
});

const FrameSchema = z.object({ type: z.string() });

/** Opens a socket to the Room as `userId` and joins, the way the SPA does. */
async function join(userId: string): Promise<void> {
  const upgrade = new Request('http://room/ws', { headers: { Upgrade: 'websocket' } });
  const res = await stub.fetch(withRoomUser(upgrade, { id: userId, name: 'Drawer' }));
  const ws = res.webSocket;
  if (!ws) throw new Error('expected a webSocket on the 101 response');
  const client = socketClient(ws, (data) => FrameSchema.parse(JSON.parse(data)));
  const payload = { mapId: ROOM.DEFAULT_ROOM_ID };
  ws.send(JSON.stringify({ type: 'join', seq: 1, ts: Date.now(), payload }));
  await client.waitFor('draft:state');
}

/**
 * Hands the Room's one socket a `draft:update` through the handler `webSocketMessage` calls, with
 * the Worker's `env` swapped for the audit lane database: the Room's audit write lands there.
 */
function draft(seq: number, op: DraftOp): Promise<void> {
  return runInDurableObject(stub, (_room, state) => {
    const [ws] = state.getWebSockets();
    const attachment = ws && attachmentOf(ws);
    if (!ws || !attachment) throw new Error('expected one joined socket');
    const room = { ctx: state, drafts: new DraftStore(state.storage.sql) };
    const now = Date.now();
    withEnv(lane, () =>
      draftUpdate(room, { ws, attachment: { ...attachment, lastSeen: now } }, seq, op, now),
    );
  });
}

const add = (index: number): DraftOp => ({ op: 'add', index, vertex: [34.8 + index / 100, 32] });

/** The user's audit rows once `count` exist (the Room writes after the frame, in `waitUntil`). */
async function rowsOnce(userId: string, count: number) {
  return vi.waitFor(
    async () => {
      const rows = await auditRowsWhere(lane, 'user_id = $1', [userId]);
      expect(rows).toHaveLength(count);
      return rows;
    },
    { timeout: 10_000, interval: 50 },
  );
}

describe('Room draw.session audit', () => {
  it('a clear after adds writes one draw.session row with the vertex count', async () => {
    const userId = `drawer-${crypto.randomUUID()}`;
    await join(userId);

    await draft(2, add(0));
    await draft(3, add(1));
    await draft(4, add(2));
    await draft(5, { op: 'clear' });

    expect(await rowsOnce(userId, 1)).toEqual([
      {
        user_id: userId,
        action: 'draw.session',
        entity: 'draft',
        entity_id: null,
        version: null,
        ip: null,
        user_agent: null,
        request_id: null,
        details: { vertices: 3 },
      },
    ]);
  }, 15_000);

  it('a clear with no draft to end writes nothing', async () => {
    const userId = `drawer-${crypto.randomUUID()}`;
    await join(userId);

    await draft(2, { op: 'clear' });
    // A later one-vertex session: once its row is in, the empty clear's would have been too.
    await draft(3, add(0));
    await draft(4, { op: 'clear' });

    const rows = await rowsOnce(userId, 1);
    expect(rows.map((row) => row.details)).toEqual([{ vertices: 1 }]);
  }, 15_000);
});
