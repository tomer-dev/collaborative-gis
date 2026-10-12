import { ROUTES, type Polygon } from '@cgis/shared';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import type pg from 'pg';
import { createApp, type Env } from '../../src/app';
import { withClient } from '../../src/db';
import { laneEnv } from '../auth/lane-db';
import { appWithUser } from '../helpers';

/** The area tests' own database (created and migrated by `laneEnv`), shared by test/areas/*. */
export const areasEnv = (): Promise<Env> => laneEnv('cgis_api');

export type TestUser = { id: string; name: string };

/** A user no other test shares: its own rate-limit budget and its own rows. */
export const freshUser = (prefix = 'user'): TestUser => ({
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

type Send = (path: string, init?: RequestInit) => Promise<Response>;

/**
 * The real app as `user` (`appWithUser`), or anonymous (`createApp()`) without one. Each request
 * gets an ExecutionContext, as the Workers runtime gives one (the routes call `waitUntil`), and is
 * awaited until its `waitUntil` work settles.
 */
export function areasClient(env: Env, user?: TestUser, headers: Record<string, string> = {}) {
  const app = user ? appWithUser(user) : createApp();
  const send: Send = async (path, init = {}) => {
    const ctx = createExecutionContext();
    const res = await app.request(
      path,
      { ...init, headers: { 'content-type': 'application/json', ...headers } },
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
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

/** Runs `fn` on a direct connection to the lane database. */
export const query = <T>(env: Env, fn: (client: pg.Client) => Promise<T>): Promise<T> =>
  withClient(env, fn);

/** The `audit_log` rows for one entity, oldest first, as the wire-level column names. */
export function auditRows(env: Env, entityId: string) {
  return query(env, async (client) => {
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
  return query(env, async (client) => {
    const { rows } = await client.query<{ n: number }>(
      `select count(*)::int as n from ${table} where ${where}`,
      values,
    );
    return rows[0]!.n;
  });
}
