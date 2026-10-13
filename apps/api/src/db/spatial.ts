import { GEO, LIMITS, type Area, type Bbox, type Polygon } from '@cgis/shared';
import { sql, type SQL } from 'drizzle-orm';
import type pg from 'pg';
import { db } from './index';
import { auditLog } from './schema';

// Spatial reads and writes on `areas` / `area_versions` / `audit_log`, one `pg.Client` per call
// (from `withClient`). Every write that touches geometry is a single statement, so it is atomic
// without a transaction (Hyperdrive pools in transaction mode).

export type AreaRow = Area;

export type AreaInput = { name: string; geometry: Polygon; userId: string };

export type UpdateResult = { ok: true; area: AreaRow } | { ok: false; current: AreaRow | null };

export type AuditRow = Omit<typeof auditLog.$inferInsert, 'id' | 'at'>;

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

/** A write's one result row: `reason` when the geometry was invalid, else the written row (all
 * NULL when no row matched). */
type WriteResult = { reason: string | null } & { [K in keyof AreaRow]: AreaRow[K] | null };

// The `Area` fields of an `areas` row. Unqualified on purpose: each statement selects them from
// exactly one relation with the `areas` columns. Timestamps become ISO 8601 UTC strings in SQL, as
// `Date.toISOString()` would print them (the `Area` contract): Drizzle's node-postgres session
// hands `timestamptz` over as Postgres text, not as a `Date`.
const AREA_COLUMNS = sql`id, name, ST_AsGeoJSON(geom)::json AS geometry, area_km2::float8 AS "areaKm2",
  version, created_by AS "createdBy",
  to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "createdAt",
  to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "updatedAt"`;

/** Geodesic area on the WGS 84 spheroid (`ST_Area(geography)` defaults to it), m² → km². */
const AREA_KM2 = sql`ST_Area(g::geography) / 1e6`;

/**
 * CTE `input(g, reason)`: the GeoJSON polygon as a geometry (SRID 4326, GeoJSON's default) and
 * `ST_IsValidReason` when `ST_IsValid` is false (NULL when valid). Writes only use `g` when `reason`
 * is NULL, so an invalid polygon writes nothing and the statement reports why.
 */
function inputCte(geometry: Polygon): SQL {
  return sql`input AS (
    SELECT g, CASE WHEN ST_IsValid(g) THEN NULL ELSE ST_IsValidReason(g) END AS reason
    FROM (SELECT ST_GeomFromGeoJSON(${JSON.stringify(geometry)}) AS g) AS parsed
  )`;
}

function toArea(row: AreaRow): AreaRow {
  const { id, name, geometry, areaKm2, version, createdBy, createdAt, updatedAt } = row;
  return { id, name, geometry, areaKm2, version, createdBy, createdAt, updatedAt };
}

/** Throws InvalidGeometryError for a rejected geometry; otherwise the written row, if any. */
function written(row: WriteResult | undefined): AreaRow | null {
  if (!row) throw new Error('write statement returned no row');
  if (row.reason !== null) throw new InvalidGeometryError(row.reason);
  return row.id === null ? null : toArea(row as AreaRow);
}

/**
 * Inserts an area and its version 1 in one statement, with `area_km2` computed by PostGIS.
 * Throws InvalidGeometryError (nothing written) when `ST_IsValid` rejects the polygon.
 */
export async function insertArea(c: pg.Client, input: AreaInput): Promise<AreaRow> {
  const { rows } = await db(c).execute<WriteResult>(sql`
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
  const area = written(rows[0]);
  if (!area) throw new Error('insert returned no row');
  return area;
}

/**
 * Optimistic update: writes name, geometry and area and bumps `version` only when the stored
 * version equals `input.version` and the area is live, recording the new version row (one
 * statement). Otherwise returns the current live row (`null` when missing or deleted), read by a
 * second statement: under READ COMMITTED (the default) that one sees a concurrent winner's commit,
 * which the UPDATE's own snapshot would not. Throws InvalidGeometryError (nothing written) for an
 * invalid polygon.
 */
export async function updateAreaIfVersion(
  c: pg.Client,
  id: string,
  input: AreaInput & { version: number },
): Promise<UpdateResult> {
  const { rows } = await db(c).execute<WriteResult>(sql`
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
    SELECT input.reason, ${AREA_COLUMNS} FROM input LEFT JOIN updated ON true`);
  const area = written(rows[0]);
  if (area) return { ok: true, area };
  return { ok: false, current: await selectLiveArea(c, id) };
}

async function selectLiveArea(c: pg.Client, id: string): Promise<AreaRow | null> {
  const { rows } = await db(c).execute<AreaRow>(
    sql`SELECT ${AREA_COLUMNS} FROM areas WHERE id = ${id} AND deleted_at IS NULL`,
  );
  return rows[0] ?? null;
}

/**
 * The viewport query: live areas whose bounding box meets the bbox (`&&`, served by the partial
 * GiST index `areas_geom_gist`), newest edits first. `&&` compares bounding boxes only, so an area
 * near the viewport may be included without touching it; the map simply draws it off-screen.
 */
export function areasInBoundsSql(
  [west, south, east, north]: Bbox,
  { limit = LIMITS.BOUNDS_LIMIT }: { limit?: number } = {},
): SQL {
  return sql`SELECT ${AREA_COLUMNS} FROM areas
    WHERE geom && ST_MakeEnvelope(${west}, ${south}, ${east}, ${north}, ${GEO.SRID})
      AND deleted_at IS NULL
    ORDER BY updated_at DESC
    LIMIT ${limit}`;
}

/** Live areas in the viewport (see areasInBoundsSql); `limit` defaults to `LIMITS.BOUNDS_LIMIT`. */
export async function selectAreasInBounds(
  c: pg.Client,
  bbox: Bbox,
  opts: { limit?: number } = {},
): Promise<AreaRow[]> {
  const { rows } = await db(c).execute<AreaRow>(areasInBoundsSql(bbox, opts));
  return rows;
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
  const { rows } = await db(c).execute<{ version: number }>(sql`
    WITH deleted AS (
      UPDATE areas SET deleted_at = now(), updated_at = now(), version = version + 1
      WHERE id = ${id} AND deleted_at IS NULL
      RETURNING *
    )
    INSERT INTO area_versions (area_id, version, name, geom, area_km2, changed_by)
    SELECT id, version, name, geom, area_km2, ${userId} FROM deleted
    RETURNING version`);
  return rows[0]?.version ?? null;
}

/** Appends one `audit_log` row (`at` defaults to now()). */
export async function writeAudit(c: pg.Client, row: AuditRow): Promise<void> {
  await db(c).insert(auditLog).values(row);
}
