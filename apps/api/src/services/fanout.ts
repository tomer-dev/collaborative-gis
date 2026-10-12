import { type AreaEvent, ROOM } from '@cgis/shared';
import type { Env } from '../app';
import { log } from '../log';

/**
 * Hands a committed area change to the single Room (`ROOM.DEFAULT_ROOM_ID`, D11) over Durable
 * Object RPC: `Room.broadcast` validates it, bumps the map version and sends it to every socket.
 *
 * The routes run this inside `c.executionCtx.waitUntil` after the commit, when the response is
 * already sent, so it never throws: a failure (Room unreachable, RPC error) is logged as one
 * `fanout failed` line carrying the route's `requestId`, and dropped. Clients that miss a change
 * resync on reconnect.
 */
export async function fanout(env: Env, event: AreaEvent, requestId: string): Promise<void> {
  try {
    await env.ROOM.get(env.ROOM.idFromName(ROOM.DEFAULT_ROOM_ID)).broadcast(event);
  } catch (err) {
    log('error', 'fanout failed', {
      requestId,
      type: event.type,
      areaId: event.type === 'area:deleted' ? event.payload.id : event.payload.area.id,
      error: err instanceof Error ? (err.stack ?? err.message) : String(err),
    });
  }
}
