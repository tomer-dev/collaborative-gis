import { AUDIT, RETENTION } from '@cgis/shared';
import {
  createExecutionContext,
  createScheduledController,
  waitOnExecutionContext,
} from 'cloudflare:test';
import type pg from 'pg';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../src/app';
import { withClient } from '../../src/db';
import { purgeDeleted } from '../../src/db/purge';
import worker from '../../src/index';
import { scheduled } from '../../src/scheduled';
import { laneEnv } from '../auth/lane-db';

declare global {
  interface ImportMeta {
    // Vite's glob import; vitest inlines the file before workerd runs the test (no vite/client types here).
    glob<T>(
      pattern: string,
      options: { query: '?raw'; import: 'default'; eager: true },
    ): Record<string, T>;
  }
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** The run's clock: a fixed instant, so cutoffs are exact. */
const NOW = new Date('2026-10-12T03:00:00.000Z');
const daysBefore = (days: number, from = NOW) => new Date(from.getTime() - days * MS_PER_DAY);

let env: Env;

beforeAll(async () => {
  // Its own lane database: purgeDeleted acts on every expired row, so no other test file may
  // share it.
  env = await laneEnv('cgis_retention');
});

// Each test starts from empty tables (this lane database is only this file's).
beforeEach(() => query('truncate area_versions, areas, audit_log'));

afterEach(() => {
  vi.restoreAllMocks();
});

function query<T extends pg.QueryResultRow>(text: string, values: unknown[] = []): Promise<T[]> {
  return withClient(env, async (client) => (await client.query<T>(text, values)).rows);
}

/** An area at version `versions` with one `area_versions` row per version; `deletedAt` null = live. */
async function seedArea(deletedAt: Date | null, versions: number): Promise<string> {
  const [row] = await query<{ id: string }>(
    `with area as (
       insert into areas (name, geom, area_km2, version, created_by, deleted_at)
       values ('retention', ST_GeomFromText('POLYGON((0 0,1 0,1 1,0 1,0 0))', 4326), 1, $1,
               'retention-test', $2)
       returning *
     ), history as (
       insert into area_versions (area_id, version, name, geom, area_km2, changed_by)
       select id, v, name, geom, area_km2, created_by from area, generate_series(1, $1) as v
     )
     select id from area`,
    [versions, deletedAt],
  );
  return row!.id;
}

/** `count` areas with one version each, all soft-deleted at `deletedAt`, in one statement. */
async function seedDeleted(count: number, deletedAt: Date): Promise<void> {
  await query(
    `with batch as (
       insert into areas (name, geom, area_km2, version, created_by, deleted_at)
       select 'retention-batch', ST_GeomFromText('POLYGON((0 0,1 0,1 1,0 1,0 0))', 4326), 1, 1,
              'retention-test', $2
       from generate_series(1, $1)
       returning *
     )
     insert into area_versions (area_id, version, name, geom, area_km2, changed_by)
     select id, 1, name, geom, area_km2, created_by from batch`,
    [count, deletedAt],
  );
}

async function counts(id: string) {
  const [row] = await query<{ areas: number; versions: number }>(
    `select (select count(*)::int from areas where id = $1) as areas,
            (select count(*)::int from area_versions where area_id = $1) as versions`,
    [id],
  );
  return row;
}

const purge = () => withClient(env, (client) => purgeDeleted(client, NOW));

describe('purgeDeleted', () => {
  it('removes areas soft-deleted before the cutoff and their versions, nothing else', async () => {
    const live = await seedArea(null, 2);
    const expired = await seedArea(daysBefore(RETENTION.DAYS + 1), 3);
    const recent = await seedArea(daysBefore(RETENTION.DAYS - 1), 2);
    const atCutoff = await seedArea(daysBefore(RETENTION.DAYS), 1);

    expect(await purge()).toEqual({ areas: 1, versions: 3 });

    expect(await counts(expired)).toEqual({ areas: 0, versions: 0 });
    expect(await counts(live)).toEqual({ areas: 1, versions: 2 });
    expect(await counts(recent)).toEqual({ areas: 1, versions: 2 });
    // The cutoff is exclusive: deleted exactly `days` ago is kept until the next run.
    expect(await counts(atCutoff)).toEqual({ areas: 1, versions: 1 });
  });

  it('is idempotent: a second run deletes nothing', async () => {
    await seedArea(daysBefore(RETENTION.DAYS + 2), 2);
    await seedArea(null, 1);

    expect(await purge()).toEqual({ areas: 1, versions: 2 });
    expect(await purge()).toEqual({ areas: 0, versions: 0 });
  });

  it('writes one audit row per batch (one for a small run), without a user, with the counts in details', async () => {
    await seedArea(daysBefore(RETENTION.DAYS + 1), 2);

    await purge();
    await purge();

    expect(
      await query('select user_id, action, entity_id, version, details from audit_log order by id'),
    ).toEqual([
      {
        user_id: null,
        action: AUDIT.ACTIONS.RETENTION_PURGE,
        entity_id: null,
        version: null,
        details: { areas: 1, versions: 2 },
      },
      {
        user_id: null,
        action: AUDIT.ACTIONS.RETENTION_PURGE,
        entity_id: null,
        version: null,
        details: { areas: 0, versions: 0 },
      },
    ]);
  });

  it(`deletes a backlog in batches of RETENTION.BATCH (${RETENTION.BATCH}) per statement until one comes back short`, async () => {
    // Two full batches and a short one (1,200 rows at the default batch of 500).
    const backlog = 1200;
    await seedDeleted(backlog, daysBefore(RETENTION.DAYS + 1));
    const live = await seedArea(null, 1);

    expect(await purge()).toEqual({ areas: backlog, versions: backlog });

    expect(
      await query(`select count(*)::int as n from areas where deleted_at is not null`),
    ).toEqual([{ n: 0 }]);
    expect(await counts(live)).toEqual({ areas: 1, versions: 1 });
    // One transaction, and one audit row, per batch: no statement deleted more than a batch.
    const rows = await query<{ details: { areas: number } }>(
      'select details from audit_log order by id',
    );
    expect(rows.map((row) => row.details.areas)).toEqual([
      RETENTION.BATCH,
      RETENTION.BATCH,
      backlog - 2 * RETENTION.BATCH,
    ]);
  }, 30_000);

  it('commits the deletes and the audit row together: a failing audit write deletes nothing', async () => {
    const expired = await seedArea(daysBefore(RETENTION.DAYS + 1), 2);
    // A real failing audit write, no mocks; dropped again below so later tests are unaffected.
    await query(`
      create or replace function test_fail_purge_audit() returns trigger language plpgsql as $$
      begin raise exception 'audit write failed (test trigger)'; end $$`);
    await query(
      'create trigger test_fail_purge_audit before insert on audit_log for each row execute function test_fail_purge_audit()',
    );
    try {
      // Drizzle wraps the driver error; the trigger's message is its cause.
      await expect(purge()).rejects.toMatchObject({
        cause: { message: 'audit write failed (test trigger)' },
      });
    } finally {
      await query('drop trigger test_fail_purge_audit on audit_log');
      await query('drop function test_fail_purge_audit()');
    }

    expect(await counts(expired)).toEqual({ areas: 1, versions: 2 });
  });
});

describe('scheduled', () => {
  it('is the Worker’s scheduled handler', () => {
    expect(worker.scheduled).toBe(scheduled);
  });

  it('purges as of the scheduled time and logs one JSON line', async () => {
    const expired = await seedArea(daysBefore(RETENTION.DAYS + 1), 2);
    const live = await seedArea(null, 1);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const controller = createScheduledController({ cron: RETENTION.CRON, scheduledTime: NOW });
    const ctx = createExecutionContext();

    await scheduled(controller, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(await counts(expired)).toEqual({ areas: 0, versions: 0 });
    expect(await counts(live)).toEqual({ areas: 1, versions: 1 });
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toEqual({
      level: 'info',
      msg: AUDIT.ACTIONS.RETENTION_PURGE,
      areas: 1,
      versions: 2,
      cron: RETENTION.CRON,
    });
  });

  it('runs on the cron wrangler.jsonc declares', () => {
    const [config] = Object.values(
      import.meta.glob<string>('../../wrangler.jsonc', {
        query: '?raw',
        import: 'default',
        eager: true,
      }),
    );
    // The one `crons` array, a single-line JSON literal (`RETENTION.CRON` documents its value).
    const crons = config?.match(/"crons":\s*(\[[^\]]*\])/)?.[1];
    expect(crons && JSON.parse(crons)).toEqual([RETENTION.CRON]);
  });
});
