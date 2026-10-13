import { AreaSchema, ROOM } from '@cgis/shared';
import { evictDurableObject, runInDurableObject } from 'cloudflare:test';
import { env, withEnv } from 'cloudflare:workers';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { Env } from '../../src/app';
import { type DraftOp, DraftStore } from '../../src/do/drafts';
import { draftUpdate } from '../../src/do/handlers';
import { withRoomUser } from '../../src/do/handoff';
import { attachmentOf } from '../../src/do/presence';
import type { TakeResult } from '../../src/do/rate-limiter';
import type { Room } from '../../src/do/room';
import { areasClient, freshUser, randomSpot, squareAt } from '../areas/fixtures';
import { TEST } from '../helpers';
import { socketClient } from '../room/socket-client';
import { auditEnv, auditRowsOf, auditRowsWhere } from './fixtures';

// D20 draw sessions: a draft saved as an area is one session, recorded by the create route in the
// same transaction as its `area.create` row. The Room writes no audit rows: a `clear` is also a
// resync, a cancel or a save, so it cannot tell a session from a replay.

let lane: Env;
beforeAll(async () => {
  lane = await auditEnv();
});

/** Long enough for a background write the Room started to land, were there one. */
const SETTLE_MS = 300;

describe('draw.session audit', () => {
  it('a saved draft is one draw session: written with area.create, same request, its vertex count', async () => {
    const user = freshUser('drawer');
    const geometry = squareAt(randomSpot());
    const res = await areasClient(lane, user, {
      'cf-connecting-ip': '203.0.113.7',
      'user-agent': 'draw-session-test/1.0',
    }).create({ name: 'sketch', geometry });
    expect(res.status).toBe(201);
    const area = AreaSchema.parse(await res.clone().json());

    const rows = await auditRowsOf(lane, res);
    expect(rows.map((row) => [row.action, row.entity, row.entity_id])).toEqual([
      ['area.create', 'area', area.id],
      ['draw.session', 'draft', null],
    ]);
    // The ring's vertices, the closing one excluded.
    expect(rows[1]).toMatchObject({
      user_id: user.id,
      version: null,
      ip: '203.0.113.7',
      user_agent: 'draw-session-test/1.0',
      details: { vertices: geometry.coordinates[0].length - 1 },
    });
  });

  it('a rejected create (422) writes no draw.session', async () => {
    const user = freshUser('drawer');
    const res = await areasClient(lane, user).create({ name: 'no geometry' });
    expect(res.status).toBe(422);
    const sessions = await auditRowsWhere(lane, 'user_id = $1 and action = $2', [
      user.id,
      'draw.session',
    ]);
    expect(sessions).toEqual([]);
  });
});

describe('the Room writes no draw.session', () => {
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
   * Hands the Room's one socket a `draft:update` through the handler `webSocketMessage` calls,
   * with the Worker's `env` swapped for the audit lane database, where a write would land.
   */
  function draft(seq: number, op: DraftOp): Promise<void> {
    return runInDurableObject(stub, async (_room, state) => {
      const [ws] = state.getWebSockets();
      const attachment = ws && attachmentOf(ws);
      if (!ws || !attachment) throw new Error('expected one joined socket');
      // The draw budget always grants: this file is about audit rows, not the limiter (H6).
      const takeDrawAction = async (): Promise<TakeResult> => ({ ok: true, remaining: 1 });
      const room = { ctx: state, drafts: new DraftStore(state.storage.sql), takeDrawAction };
      const now = Date.now();
      await withEnv(lane, () =>
        draftUpdate(room, { ws, attachment: { ...attachment, lastSeen: now } }, seq, op, now),
      );
    });
  }

  const add = (index: number): DraftOp => ({
    op: 'add',
    index,
    vertex: [34.8 + index / 100, 32],
  });

  it(
    'a clear that ends a draft (a resync, a cancel or a save) writes nothing',
    async () => {
      const userId = `drawer-${crypto.randomUUID()}`;
      await join(userId);

      await draft(2, add(0));
      await draft(3, add(1));
      await draft(4, add(2));
      await draft(5, { op: 'clear' });
      await scheduler.wait(SETTLE_MS);

      expect(await auditRowsWhere(lane, 'user_id = $1', [userId])).toEqual([]);
    },
    TEST.SLOW_TIMEOUT_MS,
  );
});
