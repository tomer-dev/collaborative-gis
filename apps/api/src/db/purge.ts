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
 * Retention (D8): hard-deletes the areas soft-deleted before `now - days` together with their
 * `area_versions`, and writes one `audit_log` row (`AUDIT.ACTIONS.RETENTION_PURGE`, no user, counts in
 * `details`), all in one transaction. Live areas and their versions are never touched; a second
 * run with the same `now` deletes nothing (the audit row is still written: one per run).
 */
export function purgeDeleted(
  client: pg.Client,
  now = new Date(),
  days: number = RETENTION.DAYS,
): Promise<PurgeCounts> {
  const cutoff = new Date(now.getTime() - days * MS_PER_DAY);
  return db(client).transaction(async (tx) => {
    // Both deletes are one builder-made statement (two data-modifying CTEs): one snapshot, so the
    // version rows removed are exactly those of the areas removed, and the area_versions foreign key
    // (NO ACTION, checked at the end of the statement) sees both deletes done.
    const purged = tx
      .$with('purged')
      .as(tx.delete(areas).where(lt(areas.deletedAt, cutoff)).returning({ id: areas.id }));
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
