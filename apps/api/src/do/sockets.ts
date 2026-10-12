import { type ApiErrorCode, WS } from '@cgis/shared';
import type { RoomEvent } from './frames';
import { attachmentOf, type PresenceAttachment } from './presence';

/** An open socket with its parsed attachment. */
export type Socket = { ws: WebSocket; attachment: PresenceAttachment };

/** Creates `counters`: the outgoing `seq` here, and the map version (`Room.bumpMapVersion`, T8). */
export function createSeqCounter(sql: SqlStorage): void {
  sql.exec('CREATE TABLE IF NOT EXISTS counters (name TEXT PRIMARY KEY, value INTEGER NOT NULL)');
}

/**
 * Open sockets with their attachments. An open socket without a valid attachment cannot be
 * attributed to a user, so it is closed here (and logged once: a closing socket is skipped).
 */
export function sockets(ctx: DurableObjectState): Socket[] {
  const open: Socket[] = [];
  for (const ws of ctx.getWebSockets()) {
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

/** Stores `changes` on top of `socket.attachment` (which carries the `lastSeen` already set). */
export function save(socket: Socket, changes: Partial<PresenceAttachment>): void {
  socket.ws.serializeAttachment({ ...socket.attachment, ...changes });
}

/** Sends `event` to one socket. */
export function sendTo(ctx: DurableObjectState, ws: WebSocket, event: RoomEvent): void {
  try {
    ws.send(stamp(ctx.storage.sql, event));
  } catch (err) {
    console.warn(JSON.stringify({ level: 'warn', msg: 'room send failed', error: String(err) }));
  }
}

/** Sends `event` (one `seq` for all) to every open socket except those of `exceptUserId`. */
export function sendAll(ctx: DurableObjectState, event: RoomEvent, exceptUserId?: string): void {
  const frame = stamp(ctx.storage.sql, event);
  for (const { ws, attachment } of sockets(ctx)) {
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

/** Sends `error { code, message, retryAfter? }` (`retryAfter` in ms) to one socket. */
export function sendError(
  ctx: DurableObjectState,
  ws: WebSocket,
  code: ApiErrorCode,
  message: string,
  extra: { retryAfter?: number } = {},
): void {
  sendTo(ctx, ws, { type: 'error', payload: { code, message, ...extra } });
}

/** The wire frame: `event` with the next `seq` from the SQLite counter and `ts = Date.now()`. */
function stamp(sql: SqlStorage, event: RoomEvent): string {
  const { seq } = sql
    .exec<{ seq: number }>(
      `INSERT INTO counters (name, value) VALUES ('seq', 1)
       ON CONFLICT (name) DO UPDATE SET value = value + 1 RETURNING value AS seq`,
    )
    .one();
  return JSON.stringify({ ...event, seq, ts: Date.now() });
}
