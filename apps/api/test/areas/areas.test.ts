import { AreaSchema, type Area } from '@cgis/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Env } from '../../src/app';
import {
  areasClient,
  areasEnv,
  auditRows,
  bboxAround,
  bowtieAt,
  countRows,
  freshUser,
  openRingAt,
  randomSpot,
  squareAt,
} from './fixtures';

// Wire values (statuses, codes, action names, column names) are spelled out on purpose: they are
// the contract the SPA and the audit trail rely on.

const IP = '203.0.113.7';
const USER_AGENT = 'areas-test/1.0';

let env: Env;
beforeAll(async () => {
  env = await areasEnv();
});

function signedIn() {
  const user = freshUser();
  const api = areasClient(env, user, { 'cf-connecting-ip': IP, 'user-agent': USER_AGENT });
  return { user, api };
}

/** Creates a 0.01° square at a fresh random spot and returns it with that spot. */
async function createSquare(api: ReturnType<typeof signedIn>['api'], name = 'square') {
  const spot = randomSpot();
  const res = await api.create({ name, geometry: squareAt(spot) });
  expect(res.status).toBe(201);
  return { spot, area: AreaSchema.parse(await res.json()) };
}

const listIds = async (api: ReturnType<typeof signedIn>['api'], query: string) => {
  const res = await api.list(query);
  expect(res.status).toBe(200);
  const { areas } = await res.json<{ areas: Area[] }>();
  return areas.map((a) => a.id);
};

describe('POST /api/areas', () => {
  it('creates an area (201, version 1, areaKm2 > 0) and one area.create audit row', async () => {
    const { user, api } = signedIn();
    const spot = randomSpot();
    const geometry = squareAt(spot);

    const res = await api.create({ name: '  Field 7  ', geometry });

    expect(res.status).toBe(201);
    const area = AreaSchema.parse(await res.json());
    expect(area).toMatchObject({ name: 'Field 7', geometry, version: 1, createdBy: user.id });
    expect(area.areaKm2).toBeGreaterThan(0);
    expect(await auditRows(env, area.id)).toEqual([
      {
        user_id: user.id,
        action: 'area.create',
        entity: 'area',
        entity_id: area.id,
        version: 1,
        ip: IP,
        user_agent: USER_AGENT,
      },
    ]);
  });

  it('answers 422 with Zod issues for an open ring and writes nothing', async () => {
    const { user, api } = signedIn();

    const res = await api.create({ name: 'open', geometry: openRingAt(randomSpot()) });

    expect(res.status).toBe(422);
    const body = await res.json<{
      code: string;
      message: string;
      details: { issues: unknown[] };
    }>();
    expect(body).toMatchObject({ code: 'UNPROCESSABLE', message: 'Unprocessable' });
    expect(body.details.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: 'Ring must be closed: first and last vertex must be equal',
        }),
      ]),
    );
    expect(await countRows(env, 'areas', 'created_by = $1', [user.id])).toBe(0);
  });

  it('answers 422 with the ST_IsValid reason for a bowtie and writes no area or audit row', async () => {
    const { user, api } = signedIn();

    const res = await api.create({ name: 'bowtie', geometry: bowtieAt(randomSpot()) });

    expect(res.status).toBe(422);
    const body = await res.json<{ code: string; message: string; details: { reason: string } }>();
    expect(body).toMatchObject({ code: 'UNPROCESSABLE', message: 'invalid geometry' });
    expect(body.details.reason).toContain('Self-intersection');
    expect(await countRows(env, 'areas', 'created_by = $1', [user.id])).toBe(0);
    expect(await countRows(env, 'audit_log', 'user_id = $1', [user.id])).toBe(0);
  });

  it('answers 422 for a missing name and for a body that is not JSON', async () => {
    const { api } = signedIn();
    expect((await api.create({ geometry: squareAt(randomSpot()) })).status).toBe(422);
    expect((await api.create('not an object')).status).toBe(422);
  });
});

describe('GET /api/areas', () => {
  it('returns the areas in the bbox, excludes a far one, and ignores zoom', async () => {
    const { api } = signedIn();
    const { spot, area } = await createSquare(api, 'near');
    const far = await createSquare(api, 'far');

    const ids = await listIds(api, `bbox=${bboxAround(spot)}`);
    expect(ids).toContain(area.id);
    expect(ids).not.toContain(far.area.id);

    expect(await listIds(api, `bbox=${bboxAround(spot)}&zoom=3`)).toEqual(ids);
    expect(await listIds(api, `bbox=${bboxAround(spot)}&zoom=18`)).toEqual(ids);
  });

  it('returns full Area objects', async () => {
    const { api } = signedIn();
    const { spot, area } = await createSquare(api);

    const res = await api.list(`bbox=${bboxAround(spot)}`);
    const { areas } = await res.json<{ areas: unknown[] }>();
    expect(areas.map((a) => AreaSchema.parse(a))).toContainEqual(area);
  });

  it('answers 422 for a malformed or missing bbox', async () => {
    const { api } = signedIn();
    expect((await api.list('bbox=1,2,3')).status).toBe(422);
    expect((await api.list('bbox=10,0,5,1')).status).toBe(422);
    expect((await api.list('')).status).toBe(422);
  });
});

describe('PUT /api/areas/:id', () => {
  it('updates with the current version (200, version 2) and writes an area.update audit row', async () => {
    const { user, api } = signedIn();
    const { spot, area } = await createSquare(api);
    const geometry = squareAt(spot, 0.02);

    const res = await api.update(area.id, { name: 'renamed', geometry, version: 1 });

    expect(res.status).toBe(200);
    const updated = AreaSchema.parse(await res.json());
    expect(updated).toMatchObject({ id: area.id, name: 'renamed', geometry, version: 2 });
    expect(updated.areaKm2).toBeGreaterThan(area.areaKm2);
    expect((await auditRows(env, area.id)).map((r) => [r.action, r.version, r.user_id])).toEqual([
      ['area.create', 1, user.id],
      ['area.update', 2, user.id],
    ]);
  });

  it('two parallel PUTs with version 1: one 200, one 409 with details.current at version 2', async () => {
    const { api } = signedIn();
    const { spot, area } = await createSquare(api);

    const [a, b] = await Promise.all([
      api.update(area.id, { name: 'a', geometry: squareAt(spot), version: 1 }),
      api.update(area.id, { name: 'b', geometry: squareAt(spot), version: 1 }),
    ]);

    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const [winner, loser] = a.status === 200 ? [a, b] : [b, a];
    const won = AreaSchema.parse(await winner.json());
    const conflict = await loser.json<{
      code: string;
      message: string;
      details: { current: Area };
    }>();
    expect(conflict).toMatchObject({ code: 'CONFLICT', message: 'version conflict' });
    expect(conflict.details.current.version).toBe(2);
    expect(conflict.details.current).toEqual(won);
    const audit = await auditRows(env, area.id);
    expect(audit.filter((r) => r.action === 'area.update')).toHaveLength(1);
  });

  it('answers 409 for a stale version and changes nothing', async () => {
    const { api } = signedIn();
    const { spot, area } = await createSquare(api);
    await api.update(area.id, { name: 'v2', geometry: squareAt(spot), version: 1 });

    const res = await api.update(area.id, { name: 'stale', geometry: squareAt(spot), version: 1 });

    expect(res.status).toBe(409);
    const body = await res.json<{ details: { current: Area } }>();
    expect(body.details.current).toMatchObject({ name: 'v2', version: 2 });
  });

  it('answers 422 for a non-UUID id and 404 for an unknown UUID', async () => {
    const { api } = signedIn();
    const body = { name: 'x', geometry: squareAt(randomSpot()), version: 1 };

    const bad = await api.update('not-a-uuid', body);
    expect(bad.status).toBe(422);
    expect(await bad.json()).toMatchObject({ code: 'UNPROCESSABLE', details: { issues: [{}] } });

    const missing = await api.update(crypto.randomUUID(), body);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ code: 'NOT_FOUND', message: 'Not found' });
  });

  it('answers 409 for a bowtie at a stale version, and 404 for a bowtie at an unknown id', async () => {
    const { api } = signedIn();
    const { spot, area } = await createSquare(api);
    await api.update(area.id, { name: 'v2', geometry: squareAt(spot), version: 1 });
    const bowtie = { name: 'x', geometry: bowtieAt(spot), version: 1 };

    const stale = await api.update(area.id, bowtie);
    expect(stale.status).toBe(409);
    const body = await stale.json<{ details: { current: Area } }>();
    expect(body.details.current).toMatchObject({ name: 'v2', version: 2 });

    expect((await api.update(crypto.randomUUID(), bowtie)).status).toBe(404);
  });

  it('answers 422 for a bowtie or a missing version and leaves the area as it was', async () => {
    const { api } = signedIn();
    const { spot, area } = await createSquare(api);

    const bowtie = await api.update(area.id, { name: 'x', geometry: bowtieAt(spot), version: 1 });
    expect(bowtie.status).toBe(422);
    expect(await bowtie.json()).toMatchObject({ details: { reason: expect.any(String) } });
    expect((await api.update(area.id, { name: 'x', geometry: squareAt(spot) })).status).toBe(422);

    const res = await api.list(`bbox=${bboxAround(spot)}`);
    const { areas } = await res.json<{ areas: Area[] }>();
    expect(areas.find((a) => a.id === area.id)).toEqual(area);
    expect((await auditRows(env, area.id)).map((r) => r.action)).toEqual(['area.create']);
  });
});

describe('DELETE /api/areas/:id', () => {
  it('soft-deletes (204), hides it from bbox, audits area.delete at the bumped version, then 404', async () => {
    const { user, api } = signedIn();
    const { spot, area } = await createSquare(api);

    const res = await api.remove(area.id);

    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
    expect(await listIds(api, `bbox=${bboxAround(spot)}`)).not.toContain(area.id);
    expect(await auditRows(env, area.id)).toEqual([
      expect.objectContaining({ action: 'area.create', version: 1 }),
      {
        user_id: user.id,
        action: 'area.delete',
        entity: 'area',
        entity_id: area.id,
        version: 2,
        ip: IP,
        user_agent: USER_AGENT,
      },
    ]);

    const again = await api.remove(area.id);
    expect(again.status).toBe(404);
    expect(await again.json()).toEqual({ code: 'NOT_FOUND', message: 'Not found' });
    expect((await auditRows(env, area.id)).map((r) => r.action)).toEqual([
      'area.create',
      'area.delete',
    ]);
  });

  it('answers 422 for a non-UUID id and 404 for an unknown UUID', async () => {
    const { api } = signedIn();
    expect((await api.remove('42')).status).toBe(422);
    expect((await api.remove(crypto.randomUUID())).status).toBe(404);
  });

  it('a deleted area cannot be updated (404)', async () => {
    const { api } = signedIn();
    const { spot, area } = await createSquare(api);
    await api.remove(area.id);

    const res = await api.update(area.id, { name: 'x', geometry: squareAt(spot), version: 2 });
    expect(res.status).toBe(404);
  });
});
