import { type AreaEvent, ROOM } from '@cgis/shared';
import type { Env } from '../app';
import { log } from '../log';

/** The single Room (`ROOM.DEFAULT_ROOM_ID`, D11). */
const roomOf = (env: Env) => env.ROOM.get(env.ROOM.idFromName(ROOM.DEFAULT_ROOM_ID));

/**
 * Bumps the Room's map version for a committed area change and returns the new version. The
 * routes await it before their response, so a bounds read that follows the response keys on the
 * new version: it can neither be served the pre-write tile nor store it under the old key (D6).
 * Never throws: a failure is logged as one `version bump failed` line and gives `undefined`; the
 * broadcast then bumps instead (`Room.broadcast`), and until it does a read may still get the old
 * entry, for at most `CACHE.BOUNDS_TTL_S`.
 */
export async function bumpMapVersion(env: Env, requestId: string): Promise<number | undefined> {
  try {
    return await roomOf(env).bumpVersion();
  } catch (err) {
    log('error', 'version bump failed', {
      requestId,
      error: err instanceof Error ? (err.stack ?? err.message) : String(err),
    });
    return undefined;
  }
}

/**
 * Hands a committed area change to the Room over Durable Object RPC: `Room.broadcast` validates
 * it and sends it to every socket, stamped with `mapVersion` (from `bumpMapVersion`).
 *
 * The routes run this inside `c.executionCtx.waitUntil` after the commit, when the response is
 * already sent, so it never throws: a failure (Room unreachable, RPC error) is logged as one
 * `fanout failed` line carrying the route's `requestId`, and dropped. Clients that miss a change
 * resync on reconnect.
 */
export async function fanout(
  env: Env,
  event: AreaEvent,
  requestId: string,
  mapVersion?: number,
): Promise<void> {
  try {
    await roomOf(env).broadcast(event, mapVersion);
  } catch (err) {
    log('error', 'fanout failed', {
      requestId,
      type: event.type,
      areaId: event.type === 'area:deleted' ? event.payload.id : event.payload.area.id,
      error: err instanceof Error ? (err.stack ?? err.message) : String(err),
    });
  }
}
