import { PresenceStateSchema, ROUTES, WS, type WsEvent } from '@cgis/shared';
import { DurableObject } from 'cloudflare:workers';
import { Context } from 'hono';
import type { Env } from '../app';
import { badRequestError, internalError, notFoundError, upgradeRequiredError } from '../errors';
import { isWebSocketUpgrade, readRoomUser, type RoomUser } from './handoff';
import { attachmentOf, type PresenceAttachment, presenceColor } from './presence';

/** The status of a WebSocket upgrade response (RFC 6455). */
const SWITCHING_PROTOCOLS = 101;

/**
 * The single map room (id `ROOM.DEFAULT_ROOM_ID`). Sockets use the WebSocket Hibernation API:
 * the runtime keeps them open while the object is evicted, so per-socket state lives in
 * attachments and nothing presence-related is kept in instance memory.
 */
export class Room extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Answered by the runtime without waking a hibernated Room (clients ping every WS.PING_INTERVAL_MS).
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(WS.AUTO_PING, WS.AUTO_PONG));
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

  /** RPC: sends `event` to every socket except those of `exceptUserId` (T7 presence, T8 fan-out). */
  async broadcast(event: WsEvent, exceptUserId?: string): Promise<void> {
    const frame = JSON.stringify(event);
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

  // T7: parse with parseWsClientMessage, then join / leave / presence:set / draft:update.
  override async webSocketMessage(): Promise<void> {}

  // T7: drop the sender's draft and broadcast presence. With compatibility_date ≥ 2026-04-07
  // (web_socket_auto_reply_to_close) the runtime completes the close handshake itself.
  override async webSocketClose(): Promise<void> {}

  // T7: same cleanup as webSocketClose.
  override async webSocketError(): Promise<void> {}

  /**
   * Open sockets with their attachments. An open socket without a valid attachment cannot be
   * attributed to a user, so it is closed here (and logged once: a closing socket is skipped).
   */
  private sockets(): Array<{ ws: WebSocket; attachment: PresenceAttachment }> {
    const open: Array<{ ws: WebSocket; attachment: PresenceAttachment }> = [];
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

  private async accept(user: RoomUser): Promise<Response> {
    const attachment: PresenceAttachment = {
      userId: user.id,
      name: user.name,
      color: await presenceColor(user.id),
      state: PresenceStateSchema.enum.viewing,
      lastSeen: Date.now(),
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
