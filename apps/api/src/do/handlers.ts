import { ERROR_CODES, ERROR_MESSAGES, type PresenceState, WS, WS_MESSAGES } from '@cgis/shared';
import { log } from '../log';
import { type DraftOp, type DraftStore, takeDraftToken } from './drafts';
import { ensureEpoch, storedEpoch } from './epoch';
import type { DraftRelay } from './frames';
import { presenceOf } from './presence';
import type { TakeResult } from './rate-limiter';
import { save, sendAll, sendError, sendTo, type Socket, sockets } from './sockets';

/**
 * What the handlers need from the Room: its state (sockets, storage), its draft store, and the
 * call that spends one `RATE_LIMIT.ACTIONS.DRAW` from a user's `RateLimiter` budget (D5).
 */
export type RoomCtx = {
  ctx: DurableObjectState;
  drafts: DraftStore;
  takeDrawAction: (userId: string) => Promise<TakeResult>;
};

/**
 * `join`: into presence (broadcast to all), then all current drafts to the joiner. The socket
 * takes the Room's storage epoch, so a join is also how a socket told to resync recovers.
 */
export function join(room: RoomCtx, socket: Socket): void {
  save(socket, { joined: true, epoch: ensureEpoch(room.ctx.storage) });
  sendPresence(room);
  sendTo(room.ctx, socket.ws, { type: 'draft:state', payload: { drafts: room.drafts.all() } });
}

/**
 * True, after answering `error CONFLICT` with `resync: true`, when `socket` joined state the Room
 * no longer has: it is joined, but its epoch is not the stored one (the storage was lost while the
 * socket stayed attached). The caller drops the frame; the socket's frames keep getting this
 * answer until it joins again.
 */
export function outlivedState(room: RoomCtx, socket: Socket): boolean {
  const { joined, epoch } = socket.attachment;
  if (!joined || epoch === storedEpoch(room.ctx.storage)) return false;
  save(socket, {});
  sendError(room.ctx, socket.ws, ERROR_CODES.CONFLICT, WS_MESSAGES.ROOM_STATE_LOST, {
    resync: true,
  });
  return true;
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
 * `draft:update`, joined sockets only. Two limits, both answered with `error RATE_LIMITED` and
 * `retryAfter` ms to the sender only: the socket's bucket (`WS.DRAFT_RATE_PER_SEC`), then one
 * action from the user's `RateLimiter` budget (D5, shared with REST mutations). A frame with
 * `seq <= lastSeq` is dropped silently in between, so it spends no budget; a failed limiter call
 * is `error INTERNAL` (fails closed). Then the op is applied to the sender's draft and relayed to
 * everyone else; an op that does not fit the Room's copy (the two diverged, or the Room dropped
 * the draft) is `error DRAFT_OP_MISFIT` with `resync: true`. room.ts runs one user's frames one at
 * a time, so no other frame of theirs touches this attachment while the limiter answers.
 */
export async function draftUpdate(
  room: RoomCtx,
  socket: Socket,
  seq: number,
  op: DraftOp,
  now: number,
): Promise<void> {
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
  // Stored before the limiter call: an alarm sweep while it runs sees this frame's lastSeen.
  save(socket, take.bucket);
  if (attachment.lastSeq !== null && seq <= attachment.lastSeq) return;
  const budget = await spendDrawAction(room, attachment.userId);
  // Closed while the limiter answered (peer close or idle sweep): the frame goes with the socket.
  if (ws.readyState !== WebSocket.OPEN) return;
  if (!budget) {
    sendError(room.ctx, ws, ERROR_CODES.INTERNAL, ERROR_MESSAGES.INTERNAL);
    return;
  }
  if (!budget.ok) {
    sendError(room.ctx, ws, ERROR_CODES.RATE_LIMITED, ERROR_MESSAGES.RATE_LIMITED, {
      retryAfter: budget.retryAfterMs,
    });
    return;
  }
  save(socket, { ...take.bucket, lastSeq: seq });
  if (!room.drafts.apply(attachment.userId, op, now)) {
    sendError(room.ctx, ws, ERROR_CODES.DRAFT_OP_MISFIT, ERROR_MESSAGES.DRAFT_OP_MISFIT, {
      resync: true,
    });
    return;
  }
  // userId after the spread: the sender's id overwrites any userId the client put in the op.
  const relay: DraftRelay = { type: 'draft:update', payload: { ...op, userId: attachment.userId } };
  sendAll(room.ctx, relay, attachment.userId);
}

/**
 * One drawing action from `userId`'s budget per frame, whatever the op; `undefined`, logged, when
 * the call fails.
 */
async function spendDrawAction(room: RoomCtx, userId: string): Promise<TakeResult | undefined> {
  try {
    return await room.takeDrawAction(userId);
  } catch (err) {
    log('error', 'rate limiter call failed', { error: String(err) });
    return undefined;
  }
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
 * The alarm's sweep: closes sockets silent for more than `WS.SOCKET_IDLE_MS` (no frame and no
 * auto-answered ping) with `WS.CLOSE_IDLE`, drops drafts not edited for `WS.PRESENCE_IDLE_MS`
 * (D13), and broadcasts `presence` / `draft:state` only when they changed. The socket cutoff is
 * the longer one, so a hidden tab whose pings the browser throttles to one a minute stays open
 * (its draft still expires). True while open sockets or drafts remain: a killed Room's sockets are
 * cut without a close event, so their drafts outlive them, and they still expire on time.
 */
export function sweepIdle(room: RoomCtx, now: number): boolean {
  const cutoff = now - WS.SOCKET_IDLE_MS;
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
  draftsChanged = room.drafts.deleteIdle(now - WS.PRESENCE_IDLE_MS) || draftsChanged;
  if (presenceChanged) sendPresence(room);
  if (draftsChanged) sendDraftState(room);
  return sockets(room.ctx).length > 0 || room.drafts.count() > 0;
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
