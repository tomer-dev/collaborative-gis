import { AreaSchema } from '@cgis/shared';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../src/app';
import { withClient } from '../../src/db';
import {
  areasClient,
  areasEnv,
  auditRows,
  countRows,
  freshUser,
  randomSpot,
  squareAt,
} from './fixtures';

// A real failing audit write, no mocks: a trigger on audit_log raises for users whose id starts
// with FAILING_PREFIX, so every other test sharing the lane database is unaffected.
const FAILING_PREFIX = 'audit-fails';

let env: Env;
beforeAll(async () => {
  env = await areasEnv();
  await withClient(env, async (client) => {
    await client.query(`
      create or replace function test_fail_audit() returns trigger language plpgsql as $$
      begin
        if new.user_id like '${FAILING_PREFIX}-%' then
          raise exception 'audit write failed (test trigger)';
        end if;
        return new;
      end $$`);
    await client.query('drop trigger if exists test_fail_audit on audit_log');
    await client.query(
      'create trigger test_fail_audit before insert on audit_log for each row execute function test_fail_audit()',
    );
  });
});

afterAll(async () => {
  await withClient(env, async (client) => {
    await client.query('drop trigger if exists test_fail_audit on audit_log');
    await client.query('drop function if exists test_fail_audit()');
  });
});

describe('a mutation and its audit row commit together', () => {
  it('create: a failing audit write answers 500 and leaves no area row', async () => {
    // onError logs the failure; keep the test output quiet.
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const user = freshUser(FAILING_PREFIX);

    const res = await areasClient(env, user).create({
      name: 'orphan?',
      geometry: squareAt(randomSpot()),
    });

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ code: 'INTERNAL', message: 'Internal Server Error' });
    expect(await countRows(env, 'areas', 'created_by = $1', [user.id])).toBe(0);
    expect(await countRows(env, 'area_versions', 'changed_by = $1', [user.id])).toBe(0);
    error.mockRestore();
  });

  it('update and delete: a failing audit write leaves the area at its previous version', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const spot = randomSpot();
    const owner = areasClient(env, freshUser());
    const created = await owner.create({ name: 'kept', geometry: squareAt(spot) });
    const area = AreaSchema.parse(await created.json());
    const failing = areasClient(env, freshUser(FAILING_PREFIX));

    const update = await failing.update(area.id, {
      name: 'lost',
      geometry: squareAt(spot),
      version: 1,
    });
    const remove = await failing.remove(area.id);

    expect([update.status, remove.status]).toEqual([500, 500]);
    expect(
      await countRows(
        env,
        'areas',
        "id = $1 and version = 1 and name = 'kept' and deleted_at is null",
        [area.id],
      ),
    ).toBe(1);
    expect(await countRows(env, 'area_versions', 'area_id = $1', [area.id])).toBe(1);
    expect((await auditRows(env, area.id)).map((r) => r.action)).toEqual(['area.create']);
    error.mockRestore();
  });
});
