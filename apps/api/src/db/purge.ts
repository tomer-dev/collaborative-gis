import { AUDIT, RETENTION } from '@cgis/shared';
import { count, inArray, lt } from 'drizzle-orm';
import type pg from 'pg';
import { db } from './index';
import { areaVersions, areas, auditLog } from './schema';

/** Unit conversion for `RETENTION.DAYS`. */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Rows one purge run deleted. */
export type PurgeCounts = { areas: number; versions: number };

/**
 * Retention (D8): hard-deletes the areas soft-deleted before `now - RETENTION.DAYS` together with
 * their `area_versions`, `RETENTION.BATCH` areas per statement, until a batch comes back short. Each batch is one
 * transaction with its own `audit_log` row (`AUDIT.ACTIONS.RETENTION_PURGE`, no user, counts in
 * `details`), so every delete is audited and a large backlog commits in steps, each well inside
 * the query timeout. Live areas and their versions are never touched; a second run with the same
 * `now` deletes nothing (and still writes one row). Returns the run's totals.
 */
export async function purgeDeleted(client: pg.Client, now: Date): Promise<PurgeCounts> {
  const cutoff = new Date(now.getTime() - RETENTION.DAYS * MS_PER_DAY);
  const total: PurgeCounts = { areas: 0, versions: 0 };
  for (;;) {
    const counts = await purgeBatch(client, cutoff);
    total.areas += counts.areas;
    total.versions += counts.versions;
    if (counts.areas < RETENTION.BATCH) return total;
  }
}

/** One batch: up to `RETENTION.BATCH` expired areas and their versions, and the batch's audit row. */
function purgeBatch(client: pg.Client, cutoff: Date): Promise<PurgeCounts> {
  return db(client).transaction(async (tx) => {
    // Both deletes are one builder-made statement (two data-modifying CTEs): one snapshot, so the
    // version rows removed are exactly those of the areas removed, and the area_versions foreign
    // key (NO ACTION, checked at the end of the statement) sees both deletes done. DELETE has no
    // LIMIT, so the batch is the ids a limited select picks.
    const expired = tx
      .select({ id: areas.id })
      .from(areas)
      .where(lt(areas.deletedAt, cutoff))
      .limit(RETENTION.BATCH);
    const purged = tx
      .$with('purged')
      .as(tx.delete(areas).where(inArray(areas.id, expired)).returning({ id: areas.id }));
    const pruned = tx.$with('pruned').as(
      tx
        .delete(areaVersions)
        .where(inArray(areaVersions.areaId, tx.select({ id: purged.id }).from(purged)))
        .returning({ areaId: areaVersions.areaId }),
    );
    const [counts] = await tx
      .with(purged, pruned)
      .select({ areas: tx.$count(purged), versions: count() })
      .from(pruned);
    if (!counts) throw new Error('purge count returned no row');

    await tx.insert(auditLog).values({
      action: AUDIT.ACTIONS.RETENTION_PURGE,
      entity: AUDIT.ENTITIES.AREA,
      details: counts,
    });
    return counts;
  });
}
