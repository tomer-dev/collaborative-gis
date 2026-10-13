import { GEO, LIMITS, type Area, type AreaVersion, type Bbox, type Polygon } from '@cgis/shared';
import { and, desc, eq, isNull, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import { db } from './index.ts';
import { areas, areaVersions } from './schema.ts';

// Spatial reads on `areas` / `area_versions`, one `pg.Client` per call (from `withClient`): Drizzle
// builder selects with PostGIS `sql` fragments (D23). The writes are in ./spatial.ts.

export type AreaRow = Area;

/**
 * A timestamp as an ISO 8601 UTC string, as `Date.toISOString()` prints it (the `Area` contract).
 * Formatted in SQL so builder reads and write CTEs agree to the millisecond.
 */
export const isoUtc = (column: AnyColumn | SQL) =>
  sql<string>`to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

/** The `Area` fields of an `areas` row for builder selects: explicit columns, geometry as GeoJSON. */
const AREA_FIELDS = {
  id: areas.id,
  name: areas.name,
  geometry: sql<Polygon>`ST_AsGeoJSON(${areas.geom})::json`,
  areaKm2: areas.areaKm2,
  version: areas.version,
  createdBy: areas.createdBy,
  createdAt: isoUtc(areas.createdAt),
  updatedAt: isoUtc(areas.updatedAt),
};

/** The live area `id` (null when missing or soft-deleted). */
export async function selectLiveArea(c: pg.Client, id: string): Promise<AreaRow | null> {
  const [area] = await db(c)
    .select(AREA_FIELDS)
    .from(areas)
    .where(and(eq(areas.id, id), isNull(areas.deletedAt)));
  return area ?? null;
}

/**
 * The viewport query: live areas whose bounding box meets the bbox (`&&`, served by the partial
 * GiST index `areas_geom_gist`), newest edits first. `&&` compares bounding boxes only, so an area
 * near the viewport may be included without touching it; the map simply draws it off-screen.
 */
function boundsQuery(
  database: Pick<ReturnType<typeof db>, 'select'>,
  [west, south, east, north]: Bbox,
  limit: number,
) {
  return database
    .select(AREA_FIELDS)
    .from(areas)
    .where(
      and(
        sql`${areas.geom} && ST_MakeEnvelope(${west}, ${south}, ${east}, ${north}, ${GEO.SRID})`,
        isNull(areas.deletedAt),
      ),
    )
    .orderBy(desc(areas.updatedAt))
    .limit(limit);
}

/** The viewport query's SQL (see selectAreasInBounds), for EXPLAIN; built without a client. */
export function areasInBoundsSql(
  bbox: Bbox,
  { limit = LIMITS.BOUNDS_LIMIT }: { limit?: number } = {},
): SQL {
  return boundsQuery(drizzle.mock(), bbox, limit).getSQL();
}

/** Live areas in the viewport (see boundsQuery); `limit` defaults to `LIMITS.BOUNDS_LIMIT`. */
export async function selectAreasInBounds(
  c: pg.Client,
  bbox: Bbox,
  { limit = LIMITS.BOUNDS_LIMIT }: { limit?: number } = {},
): Promise<AreaRow[]> {
  return await boundsQuery(db(c), bbox, limit);
}

/**
 * A live area's saved versions, newest first and at most `LIMITS.VERSIONS_PAGE` of them, each
 * geometry as GeoJSON; empty when the area is missing or soft-deleted (a live area always has at
 * least its version 1 row). A builder select (D23):
 * `ST_AsGeoJSON` is its one `sql` fragment.
 */
export async function listVersions(c: pg.Client, areaId: string): Promise<AreaVersion[]> {
  const rows = await db(c)
    .select({
      areaId: areaVersions.areaId,
      version: areaVersions.version,
      name: areaVersions.name,
      geometry: sql<Polygon>`ST_AsGeoJSON(${areaVersions.geom})::json`,
      areaKm2: areaVersions.areaKm2,
      changedBy: areaVersions.changedBy,
      changedAt: areaVersions.changedAt,
    })
    .from(areaVersions)
    .innerJoin(areas, eq(areas.id, areaVersions.areaId))
    .where(and(eq(areaVersions.areaId, areaId), isNull(areas.deletedAt)))
    .orderBy(desc(areaVersions.version))
    .limit(LIMITS.VERSIONS_PAGE);
  // The builder reads `timestamptz` as a `Date`; on the wire it is the ISO 8601 UTC string, to the
  // millisecond, as AREA_COLUMNS (./spatial.ts) prints an area's timestamps.
  return rows.map(({ changedAt, ...row }) => ({ ...row, changedAt: changedAt.toISOString() }));
}
