import { AreaSchema, type Area, type Polygon } from '@cgis/shared';
import { eq, sql, type SQL } from 'drizzle-orm';
import type pg from 'pg';
import { z } from 'zod';
import { areaKm2Of, fromGeoJson } from './geometry.ts';
import { db } from './index.ts';
import { areas, auditLog } from './schema.ts';
import { isoUtc, selectLiveArea } from './spatial-read.ts';

// Spatial writes on `areas` / `area_versions` / `audit_log`, one `pg.Client` per call (from
// `withClient`); the reads are in ./spatial-read.ts. Every write that touches geometry is a single
// statement, so it is atomic without a transaction (Hyperdrive pools in transaction mode): those
// are raw write CTEs, D23's one exception, and their result rows are Zod-parsed here before
// anything leaves this file.

export type AreaInput = { name: string; geometry: Polygon; userId: string };

export type UpdateResult = { ok: true; area: Area } | { ok: false; current: Area | null };

export type AuditRow = Omit<typeof auditLog.$inferInsert, 'id' | 'at'>;

/** A revert's result: the reverted area, or why nothing was written. */
export type RevertResult =
  | { status: 'reverted'; area: Area }
  | { status: 'conflict'; current: Area }
  | { status: 'missing' }
  | { status: 'deleted' };

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

// D23 exception (write CTEs): the same fields as AREA_FIELDS (./spatial-read.ts), unqualified on
// purpose: each write CTE selects them from exactly one relation with the `areas` columns (the
// inserted or updated row).
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
function writtenArea(row: Record<string, unknown>): Area | null {
  return row.id === null ? null : AreaSchema.parse(row);
}

/**
 * Inserts an area and its version 1 in one statement, with `area_km2` computed by PostGIS.
 * Throws InvalidGeometryError (nothing written) when `ST_IsValid` rejects the polygon.
 */
export async function insertArea(c: pg.Client, input: AreaInput): Promise<Area> {
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
 * Reverts a live area at version `expected` to its saved `version` in one statement (a
 * data-modifying CTE, the D23 exception): copies that version's name, geometry and area onto the
 * area, bumps `version`, and records the result as a new version row changed by `userId`; history
 * is never rewritten. The saved geometry passed `ST_IsValid` when it was written, so it is not
 * checked again.
 *
 * When nothing was written, a second statement says why: `deleted` (the area is soft-deleted),
 * `conflict` (it is no longer at `expected`: `current` is what is stored, D4), or `missing` (no
 * such area, or no such version of a live one). Under READ COMMITTED (the default) it sees a
 * write that committed while the UPDATE waited for the row.
 */
export async function revertArea(
  c: pg.Client,
  id: string,
  version: number,
  expected: number,
  userId: string,
): Promise<RevertResult> {
  // D23 exception: a write CTE (the revert and its version row in one statement).
  const { rows } = await db(c).execute(sql`
    WITH target AS (
      SELECT name, geom, area_km2 FROM area_versions
      WHERE area_id = ${id} AND version = ${version}
    ),
    reverted AS (
      UPDATE areas
      SET name = target.name, geom = target.geom, area_km2 = target.area_km2,
          version = areas.version + 1, updated_at = now()
      FROM target
      WHERE areas.id = ${id} AND areas.deleted_at IS NULL AND areas.version = ${expected}
      RETURNING areas.*
    ),
    next_version AS (
      INSERT INTO area_versions (area_id, version, name, geom, area_km2, changed_by)
      SELECT id, version, name, geom, area_km2, ${userId} FROM reverted
    )
    SELECT ${AREA_COLUMNS} FROM reverted`);
  const [row] = rows;
  if (row) return { status: 'reverted', area: AreaSchema.parse(row) };
  const [stored] = await db(c)
    .select({ deletedAt: areas.deletedAt, version: areas.version })
    .from(areas)
    .where(eq(areas.id, id));
  if (!stored) return { status: 'missing' };
  if (stored.deletedAt) return { status: 'deleted' };
  if (stored.version === expected) return { status: 'missing' };
  const current = await selectLiveArea(c, id);
  return current ? { status: 'conflict', current } : { status: 'deleted' };
}

/** Appends one `audit_log` row (`at` defaults to now()). */
export async function writeAudit(c: pg.Client, row: AuditRow): Promise<void> {
  await db(c).insert(auditLog).values(row);
}
