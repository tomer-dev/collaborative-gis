import { ROUTES, type Polygon } from '@cgis/shared';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { createApp, type Env } from '../../src/app';
import { withClient } from '../../src/db';
import { laneEnv } from '../auth/lane-db';
import { appWithUser, type User } from '../helpers';

/** The area tests' own database (created and migrated by `laneEnv`), shared by test/areas/*. */
export const areasEnv = (): Promise<Env> => laneEnv('cgis_api');

/** A user no other test shares: its own rate-limit budget and its own rows. */
export const freshUser = (prefix = 'user'): User => ({
  id: `${prefix}-${crypto.randomUUID()}`,
  name: 'Area Tester',
});

/**
 * A random 1°-wide spot, so rows from earlier runs (the lane database persists) and from parallel
 * test files never share a viewport with this test's rows.
 */
export function randomSpot(): [lng: number, lat: number] {
  return [r6(Math.random() * 300 - 150), r6(Math.random() * 120 - 60)];
}

/**
 * Rounds to 6 decimals (~0.1 m), so `lng + 0.01` is the decimal PostGIS prints back
 * (`ST_AsGeoJSON` keeps up to 9) rather than a binary neighbour like 12.355599999999999.
 */
const r6 = (x: number) => Math.round(x * 1e6) / 1e6;

/** A `size`° square with its south-west corner at `[lng, lat]`: a closed, counter-clockwise ring. */
export function squareAt([lng, lat]: [number, number], size = 0.01): Polygon {
  const [w, s, e, n] = [r6(lng), r6(lat), r6(lng + size), r6(lat + size)];
  return {
    type: 'Polygon',
    coordinates: [
      [
        [w, s],
        [e, s],
        [e, n],
        [w, n],
        [w, s],
      ],
    ],
  };
}

/** Two triangles crossing at the centre: passes the Zod ring rules, fails `ST_IsValid`. */
export function bowtieAt(spot: [number, number]): Polygon {
  const [a, b, c, d] = squareAt(spot).coordinates[0];
  return { type: 'Polygon', coordinates: [[a!, c!, b!, d!, a!]] };
}

/** A ring whose last vertex is not its first: Zod rejects it. */
export function openRingAt(spot: [number, number]): Polygon {
  const [a, b, c, d] = squareAt(spot).coordinates[0];
  return { type: 'Polygon', coordinates: [[a!, b!, c!, d!]] };
}

/** `bbox=w,s,e,n` around a spot, wide enough to hold `squareAt(spot)`. */
export const bboxAround = ([lng, lat]: [number, number], pad = 0.05): string =>
  [lng - pad, lat - pad, lng + pad, lat + pad].join(',');

/** The bindings `app.request` takes: the real `Env`, or a test stand-in for part of it. */
type Bindings = Parameters<ReturnType<typeof createApp>['request']>[2];

/**
 * The real app as `user` (`appWithUser`), or anonymous (`createApp()`) without one. Each request
 * gets an ExecutionContext, as the Workers runtime gives one (the routes call `waitUntil`), and is
 * awaited until its `waitUntil` work settles. With `ctx`, requests run in that one instead and the
 * caller waits on it.
 */
export function areasClient(
  env: Bindings,
  user?: User,
  headers: Record<string, string> = {},
  ctx?: ExecutionContext,
) {
  const app = user ? appWithUser(user) : createApp();
  const send = async (path: string, init: RequestInit = {}) => {
    const context = ctx ?? createExecutionContext();
    const res = await app.request(
      path,
      { ...init, headers: { 'content-type': 'application/json', ...headers } },
      env,
      context,
    );
    if (!ctx) await waitOnExecutionContext(context);
    return res;
  };
  const json = (method: string, path: string, body: unknown) =>
    send(path, { method, body: JSON.stringify(body) });
  return {
    create: (body: unknown) => json('POST', ROUTES.AREAS, body),
    list: (query: string) => send(`${ROUTES.AREAS}?${query}`),
    update: (id: string, body: unknown) => json('PUT', `${ROUTES.AREAS}/${id}`, body),
    remove: (id: string) => send(`${ROUTES.AREAS}/${id}`, { method: 'DELETE' }),
  };
}

/** The `audit_log` rows for one entity, oldest first, as the wire-level column names. */
export function auditRows(env: Env, entityId: string) {
  return withClient(env, async (client) => {
    const { rows } = await client.query(
      `select user_id, action, entity, entity_id, version, ip, user_agent
       from audit_log where entity_id = $1 order by id`,
      [entityId],
    );
    return rows;
  });
}

/** Counts rows matching `where` in `table` (both test-controlled text). */
export function countRows(env: Env, table: string, where: string, values: unknown[]) {
  return withClient(env, async (client) => {
    const { rows } = await client.query<{ n: number }>(
      `select count(*)::int as n from ${table} where ${where}`,
      values,
    );
    return rows[0]!.n;
  });
}
