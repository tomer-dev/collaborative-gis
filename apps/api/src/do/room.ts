import {
  type ApiErrorCode,
  ERROR_CODES,
  ERROR_MESSAGES,
  PresenceStateSchema,
  ROUTES,
  WS,
  WS_MESSAGES,
  type WsClientEvent,
  WsClientEventSchema,
  type WsEvent,
} from '@cgis/shared';
import { DurableObject } from 'cloudflare:workers';
import { Context } from 'hono';
import { z } from 'zod';
import type { Env } from '../app';
import { badRequestError, internalError, notFoundError, upgradeRequiredError } from '../errors';
import { DraftStore, type DraftOp, fullDraftBucket, takeDraftToken } from './drafts';
import { isWebSocketUpgrade, readRoomUser, type RoomUser } from './handoff';
import { attachmentOf, type PresenceAttachment, presenceColor, presenceOf } from './presence';

/** The status of a WebSocket upgrade response (RFC 6455). */
const SWITCHING_PROTOCOLS = 101;

type Unstamped<E> = E extends unknown ? Omit<E, 'seq' | 'ts'> : never;
/** A server event before the Room stamps it: `seq` comes from storage, `ts` from the clock. */
export type RoomEvent = Unstamped<WsEvent>;

/**
 * A `draft:update` as relayed to the other sockets: the sender's op with `userId` always set to the
 * sender (receivers pick the ghost polygon by it). The shared schema has it optional because
 * clients may omit it; any value a client sent is overwritten here.
 */
export type DraftRelay = { type: 'draft:update'; payload: DraftOp & { userId: string } };

type Socket = { ws: WebSocket; attachment: PresenceAttachment };

/**
 * The single map room (id `ROOM.DEFAULT_ROOM_ID`). Sockets use the WebSocket Hibernation API:
 * the runtime keeps them open while the object is evicted, so per-socket state lives in
 * attachments and nothing presence-related is kept in instance memory. Drafts and the outgoing
 * `seq` counter live in SQLite.
 */
export class Room extends DurableObject<Env> {
  private readonly drafts: DraftStore;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Answered by the runtime without waking a hibernated Room (clients ping every WS.PING_INTERVAL_MS).
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(WS.AUTO_PING, WS.AUTO_PONG));
    // Synchronous SQLite: the tables exist before any event reaches this instance.
    ctx.storage.sql.exec(
      'CREATE TABLE IF NOT EXISTS counters (name TEXT PRIMARY KEY, value INTEGER NOT NULL)',
    );
    this.drafts = new DraftStore(ctx.storage.sql);
  }

  /**
   * Inbound surface: exactly one thing, a `GET ROUTES.WS` WebSocket upgrade from `wsUpgrade`.
   * Only this Worker holds the `ROOM` binding, so the user headers come from an authenticated
   * session; they are still validated, and every other request gets a 4xx. Never throws.
   * 404 NOT_FOUND: other method or path · 426 UPGRADE_REQUIRED: no `Upgrade: websocket` ·
   * 400 BAD_REQUEST: missing or invalid user headers · 500 INTERNAL: logged, no socket kept.
   */
  override async fetch(request: Request): Promise<Response> {
    // errors.ts helpers need only `c.json`; a bare Context gives them that without a router.
    const c = new Context(request);
    try {
      if (request.method !== 'GET' || new URL(request.url).pathname !== ROUTES.WS) {
        return notFoundError(c);
      }
      if (!isWebSocketUpgrade(request)) return upgradeRequiredError(c);
      const user = readRoomUser(request);
      if (!user.success) return badRequestError(c, undefined, user.error.issues);
      return await this.accept(user.data);
    } catch (err) {
      console.error(
        JSON.stringify({
          level: 'error',
          msg: 'room fetch failed',
          stack: err instanceof Error ? err.stack : String(err),
        }),
      );
      return internalError(c);
    }
  }

  /**
   * RPC (T8 fan-out) and the Room's own broadcasts: stamps `event` with the next `seq` and
   * `ts = Date.now()`, then sends it to every open socket except those of `exceptUserId`.
   */
  async broadcast(event: RoomEvent, exceptUserId?: string): Promise<void> {
    this.sendAll(event, exceptUserId);
  }

  /**
   * One client frame. Unparseable → `error BAD_REQUEST` and a strike (the socket is closed with
   * `WS.CLOSE_POLICY_VIOLATION` at `WS.BAD_FRAME_STRIKES`); otherwise `join`, `leave`,
   * `presence:set` or `draft:update`. Every path stores the updated attachment.
   */
  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const attachment = attachmentOf(ws);
    if (!attachment) {
      this.sockets(); // closes and logs a socket that cannot be attributed to a user
      return;
    }
    const now = Date.now();
    const socket = { ws, attachment: { ...attachment, lastSeen: now } };
    const parsed = parseClientFrame(message);
    if (!parsed.success) {
      this.strike(socket, parsed.message);
      return;
    }
    const event = parsed.event;
    switch (event.type) {
      case 'join':
        this.join(socket);
        return;
      case 'leave':
        this.save(socket, { joined: false });
        if (socket.attachment.joined) this.departed(socket);
        return;
      case 'presence:set':
        this.save(socket, { state: event.payload.state });
        if (socket.attachment.joined) this.sendPresence();
        return;
      case 'draft:update':
        this.draftUpdate(socket, event.seq, event.payload, now);
        return;
    }
  }

  /** The peer closed: the socket leaves the room (draft dropped if it was the user's last). */
  override async webSocketClose(ws: WebSocket): Promise<void> {
    // With compatibility_date ≥ 2026-04-07 (web_socket_auto_reply_to_close) the runtime has
    // already answered the close and `ws` is CLOSED, so it is no longer among `sockets()`.
    const attachment = attachmentOf(ws);
    if (attachment?.joined) this.departed({ ws, attachment });
  }

  /** Same cleanup as a close. */
  override async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws);
  }

  /**
   * Every `WS.ALARM_INTERVAL_MS` while sockets are open: closes sockets silent for more than
   * `WS.PRESENCE_IDLE_MS` (no frame and no auto-answered ping) with `WS.CLOSE_IDLE`, drops drafts
   * not edited for that long, and broadcasts `presence` / `draft:state` only when they changed.
   */
  override async alarm(): Promise<void> {
    const now = Date.now();
    const cutoff = now - WS.PRESENCE_IDLE_MS;
    let presenceChanged = false;
    let draftsChanged = false;
    for (const socket of this.sockets()) {
      const ping = this.ctx.getWebSocketAutoResponseTimestamp(socket.ws)?.getTime() ?? 0;
      if (Math.max(socket.attachment.lastSeen, ping) >= cutoff) continue;
      this.save(socket, { joined: false });
      socket.ws.close(WS.CLOSE_IDLE);
      if (socket.attachment.joined) {
        presenceChanged = true;
        draftsChanged = this.dropDraftIfLast(socket) || draftsChanged;
      }
    }
    draftsChanged = this.drafts.deleteIdle(cutoff) || draftsChanged;
    if (presenceChanged) this.sendPresence();
    if (draftsChanged) this.sendDraftState();
    if (this.sockets().length > 0) await this.ctx.storage.setAlarm(now + WS.ALARM_INTERVAL_MS);
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

  /** `join`: into presence (broadcast to all), then the current drafts to the joiner. */
  private join(socket: Socket): void {
    this.save(socket, { joined: true });
    this.sendPresence();
    this.sendTo(socket.ws, { type: 'draft:state', payload: { drafts: this.drafts.all() } });
  }

  /**
   * `draft:update`: joined sockets only, `WS.DRAFT_RATE_PER_SEC` per socket (over budget →
   * `error RATE_LIMITED` with `retryAfter` ms to the sender only), frames with `seq <= lastSeq`
   * dropped silently, then the op is applied to the sender's draft and relayed to everyone else.
   */
  private draftUpdate(socket: Socket, seq: number, op: DraftOp, now: number): void {
    if (!socket.attachment.joined) {
      this.save(socket, {});
      this.sendError(socket.ws, ERROR_CODES.BAD_REQUEST, WS_MESSAGES.NOT_JOINED);
      return;
    }
    const take = takeDraftToken(socket.attachment, now);
    if (!take.ok) {
      this.save(socket, take.bucket);
      this.sendError(socket.ws, ERROR_CODES.RATE_LIMITED, ERROR_MESSAGES.RATE_LIMITED, {
        retryAfter: take.retryAfterMs,
      });
      return;
    }
    const { lastSeq } = socket.attachment;
    if (lastSeq !== null && seq <= lastSeq) {
      this.save(socket, take.bucket);
      return;
    }
    this.save(socket, { ...take.bucket, lastSeq: seq });
    if (!this.drafts.apply(socket.attachment.userId, op, now)) {
      this.sendError(socket.ws, ERROR_CODES.BAD_REQUEST, WS_MESSAGES.DRAFT_OP_MISFIT);
      return;
    }
    const relay: DraftRelay = {
      type: 'draft:update',
      // userId after the spread: the sender's id overwrites any userId the client put in the op.
      payload: { ...op, userId: socket.attachment.userId },
    };
    this.sendAll(relay, socket.attachment.userId);
  }

  /** A bad frame: `error BAD_REQUEST`, one strike, and at `WS.BAD_FRAME_STRIKES` a 1008 close. */
  private strike(socket: Socket, message: string): void {
    const strikes = socket.attachment.strikes + 1;
    const out = strikes >= WS.BAD_FRAME_STRIKES;
    // Leaving before the close keeps a later webSocketClose from repeating the departure.
    this.save(socket, out ? { strikes, joined: false } : { strikes });
    this.sendError(socket.ws, ERROR_CODES.BAD_REQUEST, message);
    if (!out) return;
    socket.ws.close(WS.CLOSE_POLICY_VIOLATION);
    if (socket.attachment.joined) this.departed(socket);
  }

  /** After a joined socket left: drop the draft if it was the user's last socket, rebroadcast. */
  private departed(socket: Socket): void {
    this.sendPresence();
    if (this.dropDraftIfLast(socket)) this.sendDraftState();
  }

  /** Deletes the user's draft unless another open, joined socket of theirs remains. */
  private dropDraftIfLast(socket: Socket): boolean {
    const stays = this.sockets().some(
      ({ ws, attachment }) =>
        ws !== socket.ws && attachment.joined && attachment.userId === socket.attachment.userId,
    );
    return !stays && this.drafts.delete(socket.attachment.userId);
  }

  /** Stores `changes` (and the `lastSeen` already set) in the socket's attachment. */
  private save(socket: Socket, changes: Partial<PresenceAttachment>): void {
    socket.ws.serializeAttachment({ ...socket.attachment, ...changes });
  }

  private sendPresence(): void {
    const users = presenceOf(this.sockets().map(({ attachment }) => attachment));
    this.sendAll({ type: 'presence', payload: { users } });
  }

  private sendDraftState(): void {
    this.sendAll({ type: 'draft:state', payload: { drafts: this.drafts.all() } });
  }

  private sendError(
    ws: WebSocket,
    code: ApiErrorCode,
    message: string,
    extra: { retryAfter?: number } = {},
  ): void {
    this.sendTo(ws, { type: 'error', payload: { code, message, ...extra } });
  }

  private sendTo(ws: WebSocket, event: RoomEvent): void {
    try {
      ws.send(this.stamp(event));
    } catch (err) {
      console.warn(JSON.stringify({ level: 'warn', msg: 'room send failed', error: String(err) }));
    }
  }

  private sendAll(event: RoomEvent, exceptUserId?: string): void {
    const frame = this.stamp(event);
    for (const { ws, attachment } of this.sockets()) {
      if (attachment.userId === exceptUserId) continue;
      try {
        ws.send(frame);
      } catch (err) {
        // A socket closing mid-loop must not stop delivery to the others; its close handler cleans up.
        console.warn(
          JSON.stringify({ level: 'warn', msg: 'room broadcast send failed', error: String(err) }),
        );
      }
    }
  }

  /** The wire frame: `event` with the next `seq` from the SQLite counter and `ts = Date.now()`. */
  private stamp(event: RoomEvent): string {
    const { seq } = this.ctx.storage.sql
      .exec<{ seq: number }>(
        `INSERT INTO counters (name, value) VALUES ('seq', 1)
         ON CONFLICT (name) DO UPDATE SET value = value + 1 RETURNING value AS seq`,
      )
      .one();
    return JSON.stringify({ ...event, seq, ts: Date.now() });
  }

  /**
   * Open sockets with their attachments. An open socket without a valid attachment cannot be
   * attributed to a user, so it is closed here (and logged once: a closing socket is skipped).
   */
  private sockets(): Socket[] {
    const open: Socket[] = [];
    for (const ws of this.ctx.getWebSockets()) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      const attachment = attachmentOf(ws);
      if (attachment) {
        open.push({ ws, attachment });
        continue;
      }
      console.error(
        JSON.stringify({ level: 'error', msg: 'room socket without a valid attachment; closing' }),
      );
      ws.close(WS.CLOSE_INTERNAL_ERROR);
    }
    return open;
  }
}

/** A client frame parsed with `WsClientEventSchema`, or the `error` message to answer it with. */
function parseClientFrame(
  message: string | ArrayBuffer,
): { success: true; event: WsClientEvent } | { success: false; message: string } {
  if (typeof message !== 'string') return { success: false, message: WS_MESSAGES.NOT_JSON };
  let json: unknown;
  try {
    json = JSON.parse(message);
  } catch {
    return { success: false, message: WS_MESSAGES.NOT_JSON };
  }
  const parsed = WsClientEventSchema.safeParse(json);
  return parsed.success
    ? { success: true, event: parsed.data }
    : { success: false, message: z.prettifyError(parsed.error) };
}
