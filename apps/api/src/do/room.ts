import { ERROR_CODES, PresenceStateSchema, ROUTES, WS } from '@cgis/shared';
import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../app';
import { apiErrorResponse } from '../errors';
import { DraftStore, fullDraftBucket } from './drafts';
import { parseClientFrame, type RoomEvent, SWITCHING_PROTOCOLS } from './frames';
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
import { createSeqCounter, sendAll, sockets } from './sockets';

/**
 * The single map room (id `ROOM.DEFAULT_ROOM_ID`). Sockets use the WebSocket Hibernation API:
 * the runtime keeps them open while the object is evicted, so per-socket state lives in
 * attachments and nothing presence-related is kept in instance memory. Drafts and the outgoing
 * `seq` counter live in SQLite. This class holds only the entry points; handlers.ts does the work.
 */
export class Room extends DurableObject<Env> {
  private readonly room: RoomCtx;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Answered by the runtime without waking a hibernated Room (clients ping every WS.PING_INTERVAL_MS).
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(WS.AUTO_PING, WS.AUTO_PONG));
    // Synchronous SQLite: the tables exist before any event reaches this instance.
    createSeqCounter(ctx.storage.sql);
    this.room = { ctx, drafts: new DraftStore(ctx.storage.sql) };
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

  /** RPC (T8 fan-out): stamps `seq` and `ts`, sends to every open socket but `exceptUserId`'s. */
  async broadcast(event: RoomEvent, exceptUserId?: string): Promise<void> {
    sendAll(this.ctx, event, exceptUserId);
  }

  /**
   * One client frame. Unparseable → `error BAD_REQUEST` and a strike (the socket is closed with
   * `WS.CLOSE_POLICY_VIOLATION` at `WS.BAD_FRAME_STRIKES`); otherwise `join`, `leave`,
   * `presence:set` or `draft:update`. Every path stores the updated attachment.
   */
  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const attachment = attachmentOf(ws);
    if (!attachment) {
      sockets(this.ctx); // closes and logs a socket that cannot be attributed to a user
      return;
    }
    const now = Date.now();
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
