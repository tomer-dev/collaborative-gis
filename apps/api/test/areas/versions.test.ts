import {
  type Area,
  type AreaEvent,
  AreaSchema,
  LIMITS,
  type Polygon,
  RATE_LIMIT,
  ROUTES,
  type VersionsResponse,
  VersionsResponseSchema,
} from '@cgis/shared';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { hc, type InferRequestType, type InferResponseType } from 'hono/client';
import { afterAll, beforeAll, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { type AppType, createApp, type Env } from '../../src/app';
import { withClient } from '../../src/db';
import {
  areasClient,
  areasEnv,
  auditRows,
  bboxAround,
  countRows,
  freshUser,
  randomSpot,
  squareAt,
} from './fixtures';

// TOM-58: an area's saved versions, and reverting to one of them as a new version.
// Wire values (paths, statuses, codes, messages, action names, column names) are spelled out on
// purpose: they are the contract the SPA's history panel and the audit trail rely on.

const IP = '203.0.113.9';
const USER_AGENT = 'versions-test/1.0';

/** How long the "response does not wait" test gives a response before releasing the broadcast. */
const RESPONSE_PATIENCE_MS = 2000;

let env: Env;
beforeAll(async () => {
  env = await areasEnv();
});

type Api = ReturnType<typeof areasClient>;

function signedIn(prefix?: string) {
  const user = freshUser(prefix);
  const api = areasClient(env, user, { 'cf-connecting-ip': IP, 'user-agent': USER_AGENT });
  return { user, api };
}

/**
 * An area at a fresh spot saved three times by `api`'s user: created as `v1` (a 0.01° square),
 * then updated to `v2` (0.02°) and `v3` (0.03°). `shapes[i]` is version i + 1's geometry.
 */
async function threeVersions(api: Api) {
  const spot = randomSpot();
  const shapes: Polygon[] = [squareAt(spot, 0.01), squareAt(spot, 0.02), squareAt(spot, 0.03)];
  const created = await api.create({ name: 'v1', geometry: shapes[0] });
  expect(created.status).toBe(201);
  let area = AreaSchema.parse(await created.json());
  for (const [i, geometry] of shapes.slice(1).entries()) {
    const res = await api.update(area.id, { name: `v${i + 2}`, geometry, version: area.version });
    expect(res.status).toBe(200);
    area = AreaSchema.parse(await res.json());
  }
  return { spot, shapes, area };
}

/** `GET /api/areas/:id/versions`, expected 200, parsed with the shared schema. */
async function versionsOf(api: Api, id: string) {
  const res = await api.versions(id);
  expect(res.status).toBe(200);
  return VersionsResponseSchema.parse(await res.json()).versions;
}

/**
 * `env` with a stand-in `ROOM` for the namespace calls a mutation makes (`idFromName`, then
 * `get(...).bumpVersion` before the response and `get(...).broadcast` after it), as in
 * test/room/fanout.test.ts. Test-only: production code has no switch.
 */
const withBroadcast = (broadcast: (event: AreaEvent) => Promise<void>) => ({
  ...env,
  ROOM: { idFromName: () => ({}), get: () => ({ broadcast, bumpVersion: async () => 1 }) },
});

describe('GET /api/areas/:id/versions', () => {
  it('three saves → three versions, newest first, each as it stood', async () => {
    const { user, api } = signedIn();
    const { shapes, area } = await threeVersions(api);

    const versions = await versionsOf(api, area.id);

    expect(versions.map((v) => [v.version, v.name, v.geometry])).toEqual([
      [3, 'v3', shapes[2]],
      [2, 'v2', shapes[1]],
      [1, 'v1', shapes[0]],
    ]);
    for (const v of versions) expect(v).toMatchObject({ areaId: area.id, changedBy: user.id });
    // Each version carries its own geodesic area; the newest is the area as it stands now, saved in
    // the same statement (one transaction, one now()).
    const [v3, v2, v1] = versions;
    expect(v1!.areaKm2).toBeLessThan(v2!.areaKm2);
    expect(v2!.areaKm2).toBeLessThan(v3!.areaKm2);
    expect(v3).toMatchObject({ areaKm2: area.areaKm2, changedAt: area.updatedAt });
    // Reading the history is not an action: no audit row.
    expect((await auditRows(env, area.id)).map((r) => r.action)).toEqual([
      'area.create',
      'area.update',
      'area.update',
    ]);
  });

  it('lists at most LIMITS.VERSIONS_PAGE versions: the newest ones', async () => {
    const { api } = signedIn();
    const created = await api.create({ name: 'long history', geometry: squareAt(randomSpot()) });
    const area = AreaSchema.parse(await created.json());
    // A history longer than one page, written directly: past the per-user budget through the API.
    const newest = LIMITS.VERSIONS_PAGE + 10;
    await withClient(env, (client) =>
      client.query(
        `insert into area_versions (area_id, version, name, geom, area_km2, changed_by, changed_at)
         select area_id, g, name, geom, area_km2, changed_by, changed_at
         from area_versions, generate_series(2, $2::int) g where area_id = $1 and version = 1`,
        [area.id, newest],
      ),
    );

    const versions = await versionsOf(api, area.id);

    expect(versions).toHaveLength(LIMITS.VERSIONS_PAGE);
    expect(versions[0]?.version).toBe(newest);
    expect(versions.at(-1)?.version).toBe(newest - LIMITS.VERSIONS_PAGE + 1);
  });

  it('answers 404 for an unknown or deleted area and 422 for a non-UUID id', async () => {
    const { api } = signedIn();
    const { area } = await threeVersions(api);
    expect((await api.remove(area.id)).status).toBe(204);

    for (const id of [crypto.randomUUID(), area.id]) {
      const res = await api.versions(id);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ code: 'NOT_FOUND', message: 'Not found' });
    }
    const bad = await api.versions('not-a-uuid');
    expect(bad.status).toBe(422);
    expect(await bad.json()).toMatchObject({ code: 'UNPROCESSABLE', details: { issues: [{}] } });
  });
});

describe('POST /api/areas/:id/revert/:version', () => {
  it('revert to 1 → 201 with version 4 carrying v1’s name, geometry and area; history kept; area.revert audited', async () => {
    const owner = signedIn();
    const { spot, shapes, area } = await threeVersions(owner.api);
    const before = await versionsOf(owner.api, area.id);
    // D12: any signed-in user edits; the new version and the audit row name the one who reverted.
    const editor = signedIn('editor');

    const res = await editor.api.revert(area.id, 1);

    expect(res.status).toBe(201);
    const reverted = AreaSchema.parse(await res.json());
    const v1 = before.at(-1)!;
    expect(reverted).toEqual({
      id: area.id,
      name: 'v1',
      geometry: shapes[0],
      areaKm2: v1.areaKm2,
      version: 4,
      createdBy: owner.user.id,
      createdAt: area.createdAt,
      updatedAt: expect.any(String),
    });
    expect(Date.parse(reverted.updatedAt)).toBeGreaterThan(Date.parse(area.updatedAt));

    expect(await versionsOf(owner.api, area.id)).toEqual([
      {
        areaId: area.id,
        version: 4,
        name: 'v1',
        geometry: shapes[0],
        areaKm2: v1.areaKm2,
        changedBy: editor.user.id,
        changedAt: reverted.updatedAt,
      },
      ...before,
    ]);

    // The stored area is the reverted one (the viewport query reads `areas`, not the response).
    const list = await owner.api.list(`bbox=${bboxAround(spot)}`);
    const { areas } = await list.json<{ areas: Area[] }>();
    expect(areas.find((a) => a.id === area.id)).toEqual(reverted);

    expect((await auditRows(env, area.id)).at(-1)).toEqual({
      user_id: editor.user.id,
      action: 'area.revert',
      entity: 'area',
      entity_id: area.id,
      version: 4,
      ip: IP,
      user_agent: USER_AGENT,
    });
  });

  it('a revert is a version like any other: the next PUT needs version 4', async () => {
    const { api } = signedIn();
    const { shapes, area } = await threeVersions(api);
    expect((await api.revert(area.id, 2)).status).toBe(201);

    const stale = await api.update(area.id, { name: 'late', geometry: shapes[2], version: 3 });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ details: { current: { name: 'v2', version: 4 } } });
    const fresh = await api.update(area.id, { name: 'next', geometry: shapes[2], version: 4 });
    expect(fresh.status).toBe(200);
    expect(AreaSchema.parse(await fresh.json()).version).toBe(5);
  });

  it('answers 409 CONFLICT with details.reason on a deleted area and writes nothing', async () => {
    const { api } = signedIn();
    const { area } = await threeVersions(api);
    expect((await api.remove(area.id)).status).toBe(204);

    const res = await api.revert(area.id, 1);

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      code: 'CONFLICT',
      message: 'Conflict',
      details: { reason: 'area deleted' },
    });
    // v1–v3 and the delete's v4; no revert row in either table.
    expect(await countRows(env, 'area_versions', 'area_id = $1', [area.id])).toBe(4);
    expect((await auditRows(env, area.id)).map((r) => r.action)).not.toContain('area.revert');
  });

  it('answers 404 for an unknown version or area and writes nothing', async () => {
    const { api } = signedIn();
    const { area } = await threeVersions(api);

    for (const res of [await api.revert(area.id, 9), await api.revert(crypto.randomUUID(), 1)]) {
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ code: 'NOT_FOUND', message: 'Not found' });
    }
    expect(await countRows(env, 'area_versions', 'area_id = $1', [area.id])).toBe(3);
    expect((await auditRows(env, area.id)).map((r) => r.action)).not.toContain('area.revert');
  });

  it('answers 422 for a non-UUID id or a version that is not a positive integer in int4 range', async () => {
    const { api } = signedIn();
    const id = crypto.randomUUID();
    const responses = [
      await api.revert('not-a-uuid', 1),
      await api.revert(id, 0),
      await api.revert(id, -1),
      await api.revert(id, 1.5),
      await api.revert(id, 'one'),
      // Past Postgres' integer range: rejected here instead of failing the query (a 500).
      await api.revert(id, 2 ** 31),
    ];
    for (const res of responses) {
      expect(res.status).toBe(422);
      expect(await res.json()).toMatchObject({ code: 'UNPROCESSABLE', details: { issues: [{}] } });
    }
  });
});

describe('revert: fan-out after the response', () => {
  it('sends area:updated with the 201 area, and the response does not wait for it', async () => {
    const user = freshUser();
    const { area } = await threeVersions(areasClient(env, user));
    let release = () => {};
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const order: string[] = [];
    const events: AreaEvent[] = [];
    const slow = withBroadcast(async (event) => {
      order.push('broadcast called');
      events.push(event);
      await released;
      order.push('broadcast settled');
    });
    const ctx = createExecutionContext();
    const response = areasClient(slow, user, {}, ctx)
      .revert(area.id, 1)
      .then((res) => {
        order.push('response');
        return res;
      });
    // Bounded, so a route that awaited the broadcast fails on `order` instead of hanging.
    await Promise.race([response, scheduler.wait(RESPONSE_PATIENCE_MS)]);
    release();
    const res = await response;
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(201);
    const reverted = AreaSchema.parse(await res.json());
    expect(order).toEqual(['broadcast called', 'response', 'broadcast settled']);
    expect(events).toEqual([{ type: 'area:updated', payload: { area: reverted } }]);
  });

  it('a refused revert (404, 409) broadcasts nothing', async () => {
    const user = freshUser();
    const { area } = await threeVersions(areasClient(env, user));
    const events: AreaEvent[] = [];
    const api = areasClient(
      withBroadcast(async (event) => {
        events.push(event);
      }),
      user,
    );

    expect((await api.revert(area.id, 9)).status).toBe(404);
    expect((await api.remove(area.id)).status).toBe(204);
    expect((await api.revert(area.id, 1)).status).toBe(409);
    expect(events).toEqual([{ type: 'area:deleted', payload: { id: area.id } }]);
  });
});

describe('revert and its audit row commit together', () => {
  // A real failing audit write, no mocks: a trigger on audit_log raises for users whose id starts
  // with FAILING_PREFIX (distinct from transaction.test.ts's, so the two files never interfere).
  const FAILING_PREFIX = 'revert-audit-fails';

  beforeAll(async () => {
    await withClient(env, async (client) => {
      await client.query(`
        create or replace function test_fail_revert_audit() returns trigger language plpgsql as $$
        begin
          if new.user_id like '${FAILING_PREFIX}-%' then
            raise exception 'audit write failed (test trigger)';
          end if;
          return new;
        end $$`);
      await client.query('drop trigger if exists test_fail_revert_audit on audit_log');
      await client.query(
        'create trigger test_fail_revert_audit before insert on audit_log for each row execute function test_fail_revert_audit()',
      );
    });
  });

  afterAll(async () => {
    await withClient(env, async (client) => {
      await client.query('drop trigger if exists test_fail_revert_audit on audit_log');
      await client.query('drop function if exists test_fail_revert_audit()');
    });
  });

  it('a failing audit write answers 500 and leaves the area at its previous version', async () => {
    // onError logs the failure; keep the test output quiet.
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { area } = await threeVersions(signedIn().api);

    const res = await areasClient(env, freshUser(FAILING_PREFIX)).revert(area.id, 1);

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ code: 'INTERNAL', message: 'Internal Server Error' });
    expect(
      await countRows(env, 'areas', "id = $1 and version = 3 and name = 'v3'", [area.id]),
    ).toBe(1);
    expect(await countRows(env, 'area_versions', 'area_id = $1', [area.id])).toBe(3);
    error.mockRestore();
  });
});

describe('guards', () => {
  it('answers 401 on both routes without a session, before validation', async () => {
    const api = areasClient(env);
    const id = crypto.randomUUID();
    const responses = [
      await api.versions(id),
      await api.versions('not-a-uuid'),
      await api.revert(id, 1),
      await api.revert('not-a-uuid', 'x'),
    ];
    for (const res of responses) {
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ code: 'UNAUTHORIZED', message: 'sign in' });
    }
  });

  // 50+ sequential requests through the app and the RateLimiter DO while other files run: 30 s.
  it('a revert spends the D5 mutation budget (429 past it); reading versions does not', async () => {
    const { api } = signedIn();
    const id = crypto.randomUUID();
    // Rejected reverts spend the budget too: these 422 without touching the database.
    for (let i = 0; i < RATE_LIMIT.DRAW_ACTIONS_PER_WINDOW; i++) {
      expect((await api.revert(id, 0)).status).toBe(422);
    }

    const res = await api.revert(id, 1);
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect(await res.json()).toMatchObject({ code: 'RATE_LIMITED' });
    expect((await api.versions(id)).status).toBe(404);
  }, 30_000);
});

describe('documentation and types', () => {
  it('documents both operations in /openapi.json', async () => {
    const res = await createApp().request(ROUTES.OPENAPI, {}, env);
    const { paths } = await res.json<{ paths: Record<string, Record<string, unknown>> }>();
    expect(Object.keys(paths['/api/areas/{id}/versions'] ?? {})).toEqual(['get']);
    expect(Object.keys(paths['/api/areas/{id}/revert/{version}'] ?? {})).toEqual(['post']);
  });

  it('documents the revert’s `version` as a positive int32 integer', async () => {
    const res = await createApp().request(ROUTES.OPENAPI, {}, env);
    const { paths } = await res.json<{
      paths: Record<string, { post?: { parameters?: { name: string; schema: unknown }[] } }>;
    }>();
    const params = paths['/api/areas/{id}/revert/{version}']?.post?.parameters ?? [];
    expect(params.find((p) => p.name === 'version')?.schema).toMatchObject({
      type: 'integer',
      maximum: LIMITS.VERSION_MAX,
    });
  });

  // D19: the SPA's `hc` client is typed from AppType. Compile-time checks (pnpm typecheck), plus
  // the URLs at run time.
  type One = ReturnType<typeof hc<AppType>>['api']['areas'][':id'];
  type Success<T> = Exclude<T, { code: string }>;

  it('types the two routes for the SPA client', () => {
    const one = hc<AppType>('http://localhost').api.areas[':id'];
    expect(one.versions.$url({ param: { id: 'a' } }).pathname).toBe('/api/areas/a/versions');
    expect(one.revert[':version'].$url({ param: { id: 'a', version: '2' } }).pathname).toBe(
      '/api/areas/a/revert/2',
    );
    expectTypeOf<
      Success<InferResponseType<One['versions']['$get'], 200>>
    >().toEqualTypeOf<VersionsResponse>();
    expectTypeOf<
      Success<InferResponseType<One['revert'][':version']['$post'], 201>>
    >().toEqualTypeOf<Area>();
    expectTypeOf<InferRequestType<One['revert'][':version']['$post']>['param']>().toEqualTypeOf<{
      id: string;
      version: string;
    }>();
  });
});
