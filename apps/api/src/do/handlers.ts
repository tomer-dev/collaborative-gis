import { ERROR_CODES, ERROR_MESSAGES, type PresenceState, WS, WS_MESSAGES } from '@cgis/shared';
import { type DraftOp, type DraftStore, takeDraftToken } from './drafts';
import type { DraftRelay } from './frames';
import { presenceOf } from './presence';
import { save, sendAll, sendError, sendTo, type Socket, sockets } from './sockets';

/** What the handlers need from the Room: its state (sockets, storage) and its draft store. */
export type RoomCtx = { ctx: DurableObjectState; drafts: DraftStore };

/** `join`: into presence (broadcast to all), then the current drafts to the joiner. */
export function join(room: RoomCtx, socket: Socket): void {
  save(socket, { joined: true });
  sendPresence(room);
  sendTo(room.ctx, socket.ws, { type: 'draft:state', payload: { drafts: room.drafts.all() } });
}

/** `leave`: out of presence; the socket stays open. */
export function leave(room: RoomCtx, socket: Socket): void {
  save(socket, { joined: false });
  if (socket.attachment.joined) departed(room, socket);
}

/** `presence:set`: stored in the attachment, broadcast if the socket is in presence. */
export function setPresence(room: RoomCtx, socket: Socket, state: PresenceState): void {
  save(socket, { state });
  if (socket.attachment.joined) sendPresence(room);
}

/**
 * `draft:update`: joined sockets only, `WS.DRAFT_RATE_PER_SEC` per socket (over budget →
 * `error RATE_LIMITED` with `retryAfter` ms to the sender only), frames with `seq <= lastSeq`
 * dropped silently, then the op is applied to the sender's draft and relayed to everyone else.
 */
export function draftUpdate(
  room: RoomCtx,
  socket: Socket,
  seq: number,
  op: DraftOp,
  now: number,
): void {
  const { ws, attachment } = socket;
  if (!attachment.joined) {
    save(socket, {});
    sendError(room.ctx, ws, ERROR_CODES.BAD_REQUEST, WS_MESSAGES.NOT_JOINED);
    return;
  }
  const take = takeDraftToken(attachment, now);
  if (!take.ok) {
    save(socket, take.bucket);
    sendError(room.ctx, ws, ERROR_CODES.RATE_LIMITED, ERROR_MESSAGES.RATE_LIMITED, {
      retryAfter: take.retryAfterMs,
    });
    return;
  }
  if (attachment.lastSeq !== null && seq <= attachment.lastSeq) {
    save(socket, take.bucket);
    return;
  }
  save(socket, { ...take.bucket, lastSeq: seq });
  if (!room.drafts.apply(attachment.userId, op, now)) {
    sendError(room.ctx, ws, ERROR_CODES.DRAFT_OP_MISFIT, ERROR_MESSAGES.DRAFT_OP_MISFIT);
    return;
  }
  // userId after the spread: the sender's id overwrites any userId the client put in the op.
  const relay: DraftRelay = { type: 'draft:update', payload: { ...op, userId: attachment.userId } };
  sendAll(room.ctx, relay, attachment.userId);
}

/** A bad frame: `error BAD_REQUEST`, one strike, and at `WS.BAD_FRAME_STRIKES` a 1008 close. */
export function strike(room: RoomCtx, socket: Socket, message: string): void {
  const strikes = socket.attachment.strikes + 1;
  const out = strikes >= WS.BAD_FRAME_STRIKES;
  // Leaving before the close keeps a later webSocketClose from repeating the departure.
  save(socket, out ? { strikes, joined: false } : { strikes });
  sendError(room.ctx, socket.ws, ERROR_CODES.BAD_REQUEST, message);
  if (!out) return;
  socket.ws.close(WS.CLOSE_POLICY_VIOLATION);
  if (socket.attachment.joined) departed(room, socket);
}

/** After a joined socket left: drop the draft if it was the user's last socket, rebroadcast. */
export function departed(room: RoomCtx, socket: Socket): void {
  sendPresence(room);
  if (dropDraftIfLast(room, socket)) sendDraftState(room);
}

/**
 * The alarm's sweep: closes sockets silent for more than `WS.PRESENCE_IDLE_MS` (no frame and no
 * auto-answered ping) with `WS.CLOSE_IDLE`, drops drafts not edited for that long, and broadcasts
 * `presence` / `draft:state` only when they changed. True while open sockets remain.
 */
export function sweepIdle(room: RoomCtx, now: number): boolean {
  const cutoff = now - WS.PRESENCE_IDLE_MS;
  let presenceChanged = false;
  let draftsChanged = false;
  for (const socket of sockets(room.ctx)) {
    const ping = room.ctx.getWebSocketAutoResponseTimestamp(socket.ws)?.getTime() ?? 0;
    if (Math.max(socket.attachment.lastSeen, ping) >= cutoff) continue;
    save(socket, { joined: false });
    socket.ws.close(WS.CLOSE_IDLE);
    if (socket.attachment.joined) {
      presenceChanged = true;
      draftsChanged = dropDraftIfLast(room, socket) || draftsChanged;
    }
  }
  draftsChanged = room.drafts.deleteIdle(cutoff) || draftsChanged;
  if (presenceChanged) sendPresence(room);
  if (draftsChanged) sendDraftState(room);
  return sockets(room.ctx).length > 0;
}

/** Deletes the user's draft unless another open, joined socket of theirs remains. */
function dropDraftIfLast(room: RoomCtx, socket: Socket): boolean {
  const { userId } = socket.attachment;
  const stays = sockets(room.ctx).some(
    ({ ws, attachment }) => ws !== socket.ws && attachment.joined && attachment.userId === userId,
  );
  return !stays && room.drafts.delete(userId);
}

function sendPresence(room: RoomCtx): void {
  const users = presenceOf(sockets(room.ctx).map(({ attachment }) => attachment));
  sendAll(room.ctx, { type: 'presence', payload: { users } });
}

function sendDraftState(room: RoomCtx): void {
  sendAll(room.ctx, { type: 'draft:state', payload: { drafts: room.drafts.all() } });
}
