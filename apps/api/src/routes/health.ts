import { READINESS, ROOM, ROUTES, TIMEOUTS } from '@cgis/shared';
import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import type { AppEnv, Env } from '../app';
import { db, withClient, withDeadline } from '../db';
import { areas } from '../db/schema';
import { notReadyError } from '../errors';

export const health = new Hono<AppEnv>();

health.get(ROUTES.HEALTHZ, (c) => c.json({ ok: true }));

/**
 * Both dependencies at once, each under its own deadline. 200 `{ status, db, room }` when both
 * answer; otherwise one log line with each failure and 503 `NOT_READY` with `details: { db, room }`.
 */
health.get(ROUTES.READYZ, async (c) => {
  const [db, room] = await Promise.allSettled([checkDatabase(c.env), checkRoom(c.env)]);
  const state = { db: stateOf(db), room: stateOf(room) };
  if (db.status === 'fulfilled' && room.status === 'fulfilled') {
    return c.json({ status: READINESS.READY, ...state });
  }
  console.error(
    JSON.stringify({
      level: 'error',
      msg: 'not ready',
      path: c.req.path,
      db: reasonOf(db),
      room: reasonOf(room),
    }),
  );
  return notReadyError(c, undefined, state);
});

/**
 * A Drizzle builder read (D23) with a PostGIS fragment: Postgres resolves `postgis_version()` and
 * `areas` when it plans the query, so a missing extension or an unmigrated schema fails it even
 * while the table is empty. Bounded by `withClient`'s connect deadline and query timeout, so a
 * dead database is a fast 503.
 */
export async function checkDatabase(env: Env): Promise<void> {
  await withClient(env, (client) =>
    db(client)
      .select({ postgis: sql`postgis_version()` })
      .from(areas)
      .limit(1),
  );
}

/** The default Room answers `getVersion()` within `TIMEOUTS.DO_PING_MS`, so a hung one is a fast 503. */
export async function checkRoom(env: Env): Promise<void> {
  const room = env.ROOM.get(env.ROOM.idFromName(ROOM.DEFAULT_ROOM_ID));
  await withDeadline(room.getVersion(), TIMEOUTS.DO_PING_MS, 'room ping');
}

const stateOf = (result: PromiseSettledResult<void>) =>
  result.status === 'fulfilled' ? READINESS.UP : READINESS.DOWN;

/** The failure's message for the log line; `undefined` (left out of the JSON) when it answered. */
function reasonOf(result: PromiseSettledResult<void>): string | undefined {
  if (result.status === 'fulfilled') return undefined;
  const { reason } = result;
  return reason instanceof Error ? reason.message : String(reason);
}
