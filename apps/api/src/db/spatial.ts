import {
  AreaSchema,
  GEO,
  LIMITS,
  type Area,
  type AreaVersion,
  type Bbox,
  type Polygon,
} from '@cgis/shared';
import { and, desc, eq, isNull, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import { z } from 'zod';
import { areaKm2Of, fromGeoJson } from './geometry.ts';
import { db } from './index.ts';
import { areas, areaVersions, auditLog } from './schema.ts';

// Spatial reads and writes on `areas` / `area_versions` / `audit_log`, one `pg.Client` per call
// (from `withClient`). Reads are Drizzle builder selects with PostGIS `sql` fragments (D23). Every
// write that touches geometry is a single statement, so it is atomic without a transaction
// (Hyperdrive pools in transaction mode): those are raw write CTEs, D23's one exception, and their
// result rows are Zod-parsed here before anything leaves this file.

export type AreaRow = Area;

export type AreaInput = { name: string; geometry: Polygon; userId: string };

export type UpdateResult = { ok: true; area: AreaRow } | { ok: false; current: AreaRow | null };

export type AuditRow = Omit<typeof auditLog.$inferInsert, 'id' | 'at'>;

/** A revert's result: the reverted area, or why nothing was written. */
export type RevertResult =
  { status: 'reverted'; area: AreaRow } | { status: 'missing' } | { status: 'deleted' };

/**
 * PostGIS rejected a polygon that passed Zod (e.g. a self-intersection). `reason` is the
 * `ST_IsValidReason` text, such as `Self-intersection[34.85 32.05]`, for the 422 body.
 */
export class InvalidGeometryError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(`invalid geometry: ${reason}`);
    this.name = 'InvalidGeometryError';
    this.reason = reason;
  }
}

/**
 * A timestamp as an ISO 8601 UTC string, as `Date.toISOString()` prints it (the `Area` contract).
 * Formatted in SQL so builder reads and write CTEs agree to the millisecond.
 */
const isoUtc = (column: AnyColumn | SQL) =>
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

// D23 exception (write CTEs): the same fields as AREA_FIELDS, unqualified on purpose: each write
// CTE selects them from exactly one relation with the `areas` columns (the inserted or updated row).
const AREA_COLUMNS = sql`id, name, ST_AsGeoJSON(geom)::json AS geometry, area_km2::float8 AS "areaKm2",
  version, created_by AS "createdBy",
  ${isoUtc(sql`created_at`)} AS "createdAt", ${isoUtc(sql`updated_at`)} AS "updatedAt"`;

/** Geodesic area of the CTE's input geometry `g`, in km². */
const AREA_KM2 = areaKm2Of(sql`g`);

/**
 * CTE `input(g, reason)`: the GeoJSON polygon as a geometry and `ST_IsValidReason` when
 * `ST_IsValid` is false (NULL when valid). Writes only use `g` when `reason` is NULL, so an invalid
 * polygon writes nothing and the statement reports why.
 */
function inputCte(geometry: Polygon): SQL {
  return sql`input AS (
    SELECT g, CASE WHEN ST_IsValid(g) THEN NULL ELSE ST_IsValidReason(g) END AS reason
    FROM (SELECT ${fromGeoJson(geometry)} AS g) AS parsed
  )`;
}

/** `reason`: the polygon's `ST_IsValidReason`, NULL when it is valid. */
const InsertCheckSchema = z.object({ reason: z.string().nullable() });
/** Plus `liveVersion`: the stored version of the live row as the statement found it (NULL: none). */
const UpdateCheckSchema = InsertCheckSchema.extend({ liveVersion: z.number().int().nullable() });
const VersionRowSchema = z.object({ version: z.number().int().positive() });

/** The one row every write CTE returns. */
function onlyRow(rows: Record<string, unknown>[]): Record<string, unknown> {
  const [row] = rows;
  if (!row) throw new Error('write statement returned no row');
  return row;
}

/** The written area a write CTE's row carries, parsed as an `Area`; null when nothing was written. */
function writtenArea(row: Record<string, unknown>): AreaRow | null {
  return row.id === null ? null : AreaSchema.parse(row);
}

/**
 * Inserts an area and its version 1 in one statement, with `area_km2` computed by PostGIS.
 * Throws InvalidGeometryError (nothing written) when `ST_IsValid` rejects the polygon.
 */
export async function insertArea(c: pg.Client, input: AreaInput): Promise<AreaRow> {
  // D23 exception: a write CTE (the area and its version row in one statement).
  const { rows } = await db(c).execute(sql`
    WITH ${inputCte(input.geometry)},
    inserted AS (
      INSERT INTO areas (name, geom, area_km2, created_by)
      SELECT ${input.name}, g, ${AREA_KM2}, ${input.userId} FROM input WHERE reason IS NULL
      RETURNING *
    ),
    first_version AS (
      INSERT INTO area_versions (area_id, version, name, geom, area_km2, changed_by)
      SELECT id, version, name, geom, area_km2, created_by FROM inserted
    )
    SELECT input.reason, ${AREA_COLUMNS} FROM input LEFT JOIN inserted ON true`);
  const row = onlyRow(rows);
  const { reason } = InsertCheckSchema.parse(row);
  if (reason !== null) throw new InvalidGeometryError(reason);
  const area = writtenArea(row);
  if (!area) throw new Error('insert returned no row');
  return area;
}

/**
 * Optimistic update: writes name, geometry and area and bumps `version` only when the stored
 * version equals `input.version` and the area is live, recording the new version row (one
 * statement). Otherwise returns the current live row (`null` when missing or deleted), read by a
 * second statement: under READ COMMITTED (the default) that one sees a concurrent winner's commit,
 * which the UPDATE's own snapshot would not.
 *
 * A missing area and a stale version are reported before an invalid polygon (404 and 409 before
 * 422): InvalidGeometryError (nothing written) is thrown only when the live row was at
 * `input.version`.
 */
export async function updateAreaIfVersion(
  c: pg.Client,
  id: string,
  input: AreaInput & { version: number },
): Promise<UpdateResult> {
  // D23 exception: a write CTE (the update and its version row in one statement). `liveVersion`
  // reads `areas` as the statement's snapshot saw it, before the update.
  const { rows } = await db(c).execute(sql`
    WITH ${inputCte(input.geometry)},
    updated AS (
      UPDATE areas
      SET name = ${input.name}, geom = g, area_km2 = ${AREA_KM2},
          version = areas.version + 1, updated_at = now()
      FROM input
      WHERE areas.id = ${id} AND areas.version = ${input.version}
        AND areas.deleted_at IS NULL AND input.reason IS NULL
      RETURNING areas.*
    ),
    next_version AS (
      INSERT INTO area_versions (area_id, version, name, geom, area_km2, changed_by)
      SELECT id, version, name, geom, area_km2, ${input.userId} FROM updated
    )
    SELECT input.reason,
      (SELECT live.version FROM areas AS live WHERE live.id = ${id} AND live.deleted_at IS NULL)
        AS "liveVersion",
      ${AREA_COLUMNS}
    FROM input LEFT JOIN updated ON true`);
  const row = onlyRow(rows);
  const area = writtenArea(row);
  if (area) return { ok: true, area };
  const { reason, liveVersion } = UpdateCheckSchema.parse(row);
  if (reason !== null && liveVersion === input.version) throw new InvalidGeometryError(reason);
  return { ok: false, current: await selectLiveArea(c, id) };
}

async function selectLiveArea(c: pg.Client, id: string): Promise<AreaRow | null> {
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
 * Soft-deletes a live area in one statement: sets `deleted_at`, bumps `version` like any other
 * mutation, and records that version row as changed by `userId` (the table keeps no `deleted_by`;
 * the audit row is the caller's). Returns the bumped version (the audit row's `version`), or null
 * when the area is missing or already deleted.
 */
export async function softDeleteArea(
  c: pg.Client,
  id: string,
  userId: string,
): Promise<number | null> {
  // D23 exception: a write CTE (the soft delete and its version row in one statement).
  const { rows } = await db(c).execute(sql`
    WITH deleted AS (
      UPDATE areas SET deleted_at = now(), updated_at = now(), version = version + 1
      WHERE id = ${id} AND deleted_at IS NULL
      RETURNING *
    )
    INSERT INTO area_versions (area_id, version, name, geom, area_km2, changed_by)
    SELECT id, version, name, geom, area_km2, ${userId} FROM deleted
    RETURNING version`);
  const [row] = rows;
  return row ? VersionRowSchema.parse(row).version : null;
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
  // millisecond, as AREA_COLUMNS prints an area's timestamps.
  return rows.map(({ changedAt, ...row }) => ({ ...row, changedAt: changedAt.toISOString() }));
}

/**
 * Reverts a live area to its saved `version` in one statement (a data-modifying CTE, the D23
 * exception): copies that version's name, geometry and area onto the area, bumps `version`, and
 * records the result as a new version row changed by `userId`; history is never rewritten. The
 * saved geometry passed `ST_IsValid` when it was written, so it is not checked again.
 *
 * When nothing was written, a second statement says why: `deleted` (the area is soft-deleted) or
 * `missing` (no such area, or no such version of a live one). Under READ COMMITTED (the default)
 * it sees a delete that committed while the UPDATE waited for the row.
 */
export async function revertArea(
  c: pg.Client,
  id: string,
  version: number,
  userId: string,
): Promise<RevertResult> {
  const { rows } = await db(c).execute<AreaRow>(sql`
    WITH target AS (
      SELECT name, geom, area_km2 FROM area_versions
      WHERE area_id = ${id} AND version = ${version}
    ),
    reverted AS (
      UPDATE areas
      SET name = target.name, geom = target.geom, area_km2 = target.area_km2,
          version = areas.version + 1, updated_at = now()
      FROM target
      WHERE areas.id = ${id} AND areas.deleted_at IS NULL
      RETURNING areas.*
    ),
    next_version AS (
      INSERT INTO area_versions (area_id, version, name, geom, area_km2, changed_by)
      SELECT id, version, name, geom, area_km2, ${userId} FROM reverted
    )
    SELECT ${AREA_COLUMNS} FROM reverted`);
  const area = rows[0];
  if (area) return { status: 'reverted', area };
  const [current] = await db(c)
    .select({ deletedAt: areas.deletedAt })
    .from(areas)
    .where(eq(areas.id, id));
  return current?.deletedAt ? { status: 'deleted' } : { status: 'missing' };
}

/** Appends one `audit_log` row (`at` defaults to now()). */
export async function writeAudit(c: pg.Client, row: AuditRow): Promise<void> {
  await db(c).insert(auditLog).values(row);
}
