import { type ApiErrorCode, WS } from '@cgis/shared';
import { log } from '../log';
import type { RoomEvent } from './frames';
import { attachmentOf, type PresenceAttachment } from './presence';

/** An open socket with its parsed attachment. */
export type Socket = { ws: WebSocket; attachment: PresenceAttachment };

/** Creates `counters`, the SQLite table behind the outgoing `seq` and the map version (T8). */
export function createSeqCounter(sql: SqlStorage): void {
  sql.exec('CREATE TABLE IF NOT EXISTS counters (name TEXT PRIMARY KEY, value INTEGER NOT NULL)');
}

/** Adds one to the `name` counter (the first value is 1) and returns the new value. */
export function bump(sql: SqlStorage, name: 'seq' | 'mapVersion'): number {
  return sql
    .exec<{ value: number }>(
      `INSERT INTO counters (name, value) VALUES (?, 1)
       ON CONFLICT (name) DO UPDATE SET value = value + 1 RETURNING value`,
      name,
    )
    .one().value;
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
    log('error', 'room socket without a valid attachment; closing');
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
  trySend(ws, stamp(ctx.storage.sql, event));
}

/** Sends `event` (one `seq` for all) to every open socket except those of `exceptUserId`. */
export function sendAll(ctx: DurableObjectState, event: RoomEvent, exceptUserId?: string): void {
  const frame = stamp(ctx.storage.sql, event);
  for (const { ws, attachment } of sockets(ctx)) {
    if (attachment.userId !== exceptUserId) trySend(ws, frame);
  }
}

/** A socket closing mid-send must not stop the caller (a broadcast loop); its close cleans up. */
function trySend(ws: WebSocket, frame: string): void {
  try {
    ws.send(frame);
  } catch (err) {
    log('warn', 'room send failed', { error: String(err) });
  }
}

/**
 * Sends `error { code, message, retryAfter?, resync? }` to one socket: `retryAfter` in ms;
 * `resync: true` when the client must rebuild (join again, resend its draft).
 */
export function sendError(
  ctx: DurableObjectState,
  ws: WebSocket,
  code: ApiErrorCode,
  message: string,
  extra: { retryAfter?: number; resync?: boolean; frameSeq?: number } = {},
): void {
  sendTo(ctx, ws, { type: 'error', payload: { code, message, ...extra } });
}

/** The wire frame: `event` with the next `seq` from the SQLite counter and `ts = Date.now()`. */
function stamp(sql: SqlStorage, event: RoomEvent): string {
  return JSON.stringify({ ...event, seq: bump(sql, 'seq'), ts: Date.now() });
}
