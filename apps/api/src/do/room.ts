import {
  type AreaEvent,
  AreaEventSchema,
  ERROR_CODES,
  PresenceStateSchema,
  RATE_LIMIT,
  ROUTES,
  WS,
} from '@cgis/shared';
import { DurableObject } from 'cloudflare:workers';
import { z } from 'zod';
import type { Env } from '../app';
import { apiErrorResponse } from '../errors';
import { DraftStore, fullDraftBucket } from './drafts';
import { parseClientFrame, SWITCHING_PROTOCOLS } from './frames';
import {
  departed,
  draftUpdate,
  join,
  leave,
  type RoomCtx,
  setPresence,
  strike,
  sweepIdle,
} from './handlers';
import { isWebSocketUpgrade, readRoomUser, type RoomUser } from './handoff';
import { attachmentOf, type PresenceAttachment, presenceColor } from './presence';
import { bump, createSeqCounter, sendAll, sockets } from './sockets';

/**
 * The single map room (id `ROOM.DEFAULT_ROOM_ID`). Sockets use the WebSocket Hibernation API:
 * the runtime keeps them open while the object is evicted, so per-socket state lives in
 * attachments and nothing presence-related is kept in instance memory. Drafts, the outgoing
 * `seq` counter and the map version (`mapVersion`) live in SQLite. This class holds only the
 * entry points; handlers.ts does the work.
 */
export class Room extends DurableObject<Env> {
  private readonly room: RoomCtx;
  /** Per user, the last queued frame (see `webSocketMessage`); removed once the queue is empty. */
  private readonly queues = new Map<string, Promise<void>>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Answered by the runtime without waking a hibernated Room (clients ping every WS.PING_INTERVAL_MS).
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(WS.AUTO_PING, WS.AUTO_PONG));
    // Synchronous SQLite: the tables exist before any event reaches this instance.
    createSeqCounter(ctx.storage.sql);
    this.room = {
      ctx,
      drafts: new DraftStore(ctx.storage.sql),
      takeDrawAction: (userId) =>
        env.RATE_LIMITER.get(env.RATE_LIMITER.idFromName(userId)).take(RATE_LIMIT.ACTIONS.DRAW),
    };
  }

  /**
   * Inbound surface: exactly one thing, a `GET ROUTES.WS` WebSocket upgrade from `wsUpgrade`.
   * Only this Worker holds the `ROOM` binding, so the user headers come from an authenticated
   * session; they are still validated, and every other request gets a 4xx. Never throws.
   * 404 NOT_FOUND: other method or path · 426 UPGRADE_REQUIRED: no `Upgrade: websocket` ·
   * 400 BAD_REQUEST: missing or invalid user headers · 500 INTERNAL: logged, no socket kept.
   */
  override async fetch(request: Request): Promise<Response> {
    try {
      if (request.method !== 'GET' || new URL(request.url).pathname !== ROUTES.WS) {
        return apiErrorResponse(ERROR_CODES.NOT_FOUND);
      }
      if (!isWebSocketUpgrade(request)) return apiErrorResponse(ERROR_CODES.UPGRADE_REQUIRED);
      const user = readRoomUser(request);
      if (!user.success) {
        return apiErrorResponse(ERROR_CODES.BAD_REQUEST, undefined, user.error.issues);
      }
      return await this.accept(user.data);
    } catch (err) {
      const stack = err instanceof Error ? err.stack : String(err);
      console.error(JSON.stringify({ level: 'error', msg: 'room fetch failed', stack }));
      return apiErrorResponse(ERROR_CODES.INTERNAL);
    }
  }

  /**
   * RPC from `fanout` (T8): a committed area change for every open socket. The event is checked
   * against the shared `AreaEventSchema` first; an invalid one is logged and dropped (nothing
   * sent, version unchanged) and never thrown back to the Worker. A valid one bumps the map
   * version once (`bumpVersion`) and goes out stamped with that `mapVersion`, the next `seq` and
   * `ts = Date.now()`. Both counters are written with no I/O in between, so they commit together
   * before any frame leaves.
   */
  async broadcast(event: AreaEvent): Promise<void> {
    const parsed = AreaEventSchema.safeParse(event);
    if (!parsed.success) {
      console.error(
        JSON.stringify({
          level: 'error',
          msg: 'room broadcast rejected an invalid event',
          issues: z.prettifyError(parsed.error),
        }),
      );
      return;
    }
    sendAll(this.ctx, { ...parsed.data, mapVersion: await this.bumpVersion() });
  }

  /**
   * RPC: the map version, 0 until the first area change, then one more per `broadcast`. Kept in
   * the SQLite `counters` table, so it survives eviction (D6: M2 keys the viewport cache on it).
   */
  async getVersion(): Promise<number> {
    const [row] = this.ctx.storage.sql
      .exec<{ value: number }>(`SELECT value FROM counters WHERE name = 'mapVersion'`)
      .toArray();
    return row?.value ?? 0;
  }

  /**
   * RPC: adds one to the map version and returns the new value. Every `area:*` broadcast calls it
   * once; a direct call moves every version-keyed cache entry out of use without a broadcast.
   */
  async bumpVersion(): Promise<number> {
    return bump(this.ctx.storage.sql, 'mapVersion');
  }

  /**
   * One client frame, queued behind the same user's earlier frames: `draft:update` awaits the
   * user's `RateLimiter`, and the runtime delivers the next frame meanwhile, so without the queue
   * a `leave` or a newer `seq` could overtake it and a stale attachment copy could be saved over a
   * newer one. Other users' frames do not wait. In memory only: the runtime does not hibernate a
   * Room while a handler is still running.
   */
  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const attachment = attachmentOf(ws);
    if (!attachment) {
      sockets(this.ctx); // closes and logs a socket that cannot be attributed to a user
      return;
    }
    const { userId } = attachment;
    // Taken on arrival, not when the frame's turn comes: the socket's draft bucket and lastSeen
    // measure what the client sent, not how long the limiter took to answer earlier frames.
    const receivedAt = Date.now();
    const run = (this.queues.get(userId) ?? Promise.resolve()).then(() =>
      this.handleFrame(ws, message, receivedAt),
    );
    // The queue goes on past a failed frame; the failure still reaches the runtime through `run`.
    const tail = run.catch(() => {});
    this.queues.set(userId, tail);
    try {
      await run;
    } finally {
      if (this.queues.get(userId) === tail) this.queues.delete(userId);
    }
  }

  /**
   * Unparseable → `error BAD_REQUEST` and a strike (the socket is closed with
   * `WS.CLOSE_POLICY_VIOLATION` at `WS.BAD_FRAME_STRIKES`); otherwise `join`, `leave`,
   * `presence:set` or `draft:update`. Every path stores the updated attachment, read here (not at
   * enqueue time) so it includes the frames handled before this one. `now` is the arrival time.
   */
  private async handleFrame(
    ws: WebSocket,
    message: string | ArrayBuffer,
    now: number,
  ): Promise<void> {
    const attachment = attachmentOf(ws);
    if (!attachment) {
      sockets(this.ctx);
      return;
    }
    const socket = { ws, attachment: { ...attachment, lastSeen: now } };
    const parsed = parseClientFrame(message);
    if (!parsed.success) return strike(this.room, socket, parsed.message);
    const { event } = parsed;
    switch (event.type) {
      case 'join':
        return join(this.room, socket);
      case 'leave':
        return leave(this.room, socket);
      case 'presence:set':
        return setPresence(this.room, socket, event.payload.state);
      case 'draft:update':
        return draftUpdate(this.room, socket, event.seq, event.payload, now);
    }
  }

  /** The peer closed: the socket leaves the room (draft dropped if it was the user's last). */
  override async webSocketClose(ws: WebSocket): Promise<void> {
    // With compatibility_date ≥ 2026-04-07 (web_socket_auto_reply_to_close) the runtime has
    // already answered the close and `ws` is CLOSED, so it is no longer among `sockets()`.
    const attachment = attachmentOf(ws);
    if (attachment?.joined) departed(this.room, { ws, attachment });
  }

  /** Same cleanup as a close. */
  override async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws);
  }

  /** Every `WS.ALARM_INTERVAL_MS` while sockets are open: the idle sweep, then re-arm. */
  override async alarm(): Promise<void> {
    const now = Date.now();
    if (sweepIdle(this.room, now)) await this.ctx.storage.setAlarm(now + WS.ALARM_INTERVAL_MS);
  }

  private async accept(user: RoomUser): Promise<Response> {
    const now = Date.now();
    // One alarm per object: the first socket starts the sweep and alarm() re-arms it. Armed before
    // accepting, so a storage failure here is a 500 that leaves no socket behind.
    if ((await this.ctx.storage.getAlarm()) === null) {
      await this.ctx.storage.setAlarm(now + WS.ALARM_INTERVAL_MS);
    }
    const attachment: PresenceAttachment = {
      userId: user.id,
      name: user.name,
      color: await presenceColor(user.id),
      state: PresenceStateSchema.enum.viewing,
      lastSeen: now,
      joined: false,
      strikes: 0,
      ...fullDraftBucket(now),
      lastSeq: null,
    };
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    // Attach before accepting: if serializing ever failed, the Room would not be left owning a
    // socket without an attachment. acceptWebSocket (not server.accept()) makes it hibernatable.
    server.serializeAttachment(attachment);
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: SWITCHING_PROTOCOLS, webSocket: client });
  }
}
