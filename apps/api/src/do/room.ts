import { DEV, PresenceStateSchema, ROOM, ROUTES, WS, type WsEvent } from '@cgis/shared';
import { DurableObject } from 'cloudflare:workers';
import { type Context, Hono } from 'hono';
import type { Env } from '../app';
import { notFoundError, unauthorizedError, upgradeRequiredError } from '../errors';
import { attachmentOf, type PresenceAttachment, presenceColor } from './presence';

/** The status of a WebSocket upgrade response (RFC 6455). */
const SWITCHING_PROTOCOLS = 101;

type RoomEnv = { Bindings: Env };

/**
 * The single map room (id `ROOM.DEFAULT_ROOM_ID`). Sockets use the WebSocket Hibernation API:
 * the runtime keeps them open while the object is evicted, so per-socket state lives in
 * attachments and nothing presence-related is kept in instance memory.
 */
export class Room extends DurableObject<Env> {
  private readonly router = new Hono<RoomEnv>()
    .get(ROOM.DEBUG_COUNT_PATH, (c) => this.debugCount(c))
    .get(ROUTES.WS, (c) => this.accept(c))
    .notFound((c) => notFoundError(c))
    // The Worker's onError logs and sanitises; rethrow so the error reaches it through stub.fetch().
    .onError((err) => {
      throw err;
    });

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Answered by the runtime without waking a hibernated Room (clients ping every WS.PING_INTERVAL_MS).
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(WS.AUTO_PING, WS.AUTO_PONG));
  }

  /** Only `wsUpgrade` (ws.ts) calls this, with the user in `ROOM.USER_*_HEADER`. */
  override async fetch(request: Request): Promise<Response> {
    return this.router.fetch(request, this.env);
  }

  /** RPC: sends `event` to every socket except those of `exceptUserId` (T7 presence, T8 fan-out). */
  async broadcast(event: WsEvent, exceptUserId?: string): Promise<void> {
    const frame = JSON.stringify(event);
    for (const ws of this.ctx.getWebSockets()) {
      if (exceptUserId !== undefined && attachmentOf(ws).userId === exceptUserId) continue;
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

  private async accept(c: Context<RoomEnv>): Promise<Response> {
    if (c.req.header('upgrade')?.toLowerCase() !== 'websocket') return upgradeRequiredError(c);
    const userId = c.req.header(ROOM.USER_ID_HEADER);
    const name = c.req.header(ROOM.USER_NAME_HEADER);
    if (!userId || !name) return unauthorizedError(c);

    const attachment: PresenceAttachment = {
      userId,
      // ws.ts percent-encodes the name: header values cannot carry non-Latin-1 text.
      name: decodeURIComponent(name),
      color: await presenceColor(userId),
      state: PresenceStateSchema.enum.viewing,
      lastSeen: Date.now(),
    };
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    // Attach first: an attachment over 16 KiB throws here, before the Room owns a socket with no
    // attachment. acceptWebSocket (not server.accept()) makes the socket hibernatable.
    server.serializeAttachment(attachment);
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: SWITCHING_PROTOCOLS, webSocket: client });
  }

  /** Test-only socket count, behind the same flag as the stub auth. */
  private debugCount(c: Context<RoomEnv>): Response {
    if (c.env.DEBUG_STUB_AUTH !== DEV.STUB_AUTH_ON) return notFoundError(c);
    return c.json({ count: this.ctx.getWebSockets().length });
  }
}
