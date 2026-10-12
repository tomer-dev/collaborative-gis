import { AUDIT, LIMITS, type Area, type AreaCreate, type AreaUpdate } from '@cgis/shared';
import type pg from 'pg';
import type { Env } from '../app';
import { db, withClient } from '../db';
import {
  InvalidGeometryError,
  insertArea,
  selectAreasInBounds,
  softDeleteArea,
  updateAreaIfVersion,
  writeAudit,
  type AuditRow,
  type Bbox,
} from '../db/spatial';

// Area mutations and their audit rows (D20). Each mutation runs on one per-request client in one
// transaction, so the area write and its `audit_log` row commit together or not at all.

/** Who acted, for the audit row: the session user and the request's client hints. */
export type Actor = { userId: string; ip: string | null; userAgent: string | null };

type AuditAction = (typeof AUDIT.ACTIONS)[keyof typeof AUDIT.ACTIONS];

/** PostGIS rejected the polygon (`ST_IsValidReason`); nothing was written. */
type Invalid = { status: 'invalid'; reason: string };

export type CreateOutcome = { status: 'created'; area: Area } | Invalid;
export type UpdateOutcome =
  | { status: 'updated'; area: Area }
  | { status: 'conflict'; current: Area }
  | { status: 'missing' }
  | Invalid;
export type DeleteOutcome = { status: 'deleted'; version: number } | { status: 'missing' };

/** The live areas in the viewport, newest edits first, at most `LIMITS.BOUNDS_LIMIT`. */
export function listAreas(env: Env, bbox: Bbox): Promise<Area[]> {
  return withClient(env, (client) =>
    selectAreasInBounds(client, bbox, { limit: LIMITS.BOUNDS_LIMIT }),
  );
}

/** Inserts the area (version 1) and its `area.create` audit row. */
export function createArea(env: Env, input: AreaCreate, actor: Actor): Promise<CreateOutcome> {
  return orInvalid(
    inTransaction(env, async (client): Promise<CreateOutcome> => {
      const area = await insertArea(client, { ...input, userId: actor.userId });
      await writeAudit(client, auditRow(actor, AUDIT.ACTIONS.AREA_CREATE, area.id, area.version));
      return { status: 'created', area };
    }),
  );
}

/**
 * Optimistic update: applies only when `input.version` is the stored version, then writes the
 * `area.update` audit row at the new version. A concurrent winner holds the row lock until its
 * transaction (audit row included) commits, so the loser sees its version and gets `conflict`.
 */
export function updateArea(
  env: Env,
  id: string,
  { name, geometry, version }: AreaUpdate,
  actor: Actor,
): Promise<UpdateOutcome> {
  return orInvalid(
    inTransaction(env, async (client): Promise<UpdateOutcome> => {
      const input = { name, geometry, version, userId: actor.userId };
      const result = await updateAreaIfVersion(client, id, input);
      if (!result.ok) {
        const { current } = result;
        return current ? { status: 'conflict', current } : { status: 'missing' };
      }
      const { area } = result;
      await writeAudit(client, auditRow(actor, AUDIT.ACTIONS.AREA_UPDATE, area.id, area.version));
      return { status: 'updated', area };
    }),
  );
}

/** Soft-deletes a live area and writes the `area.delete` audit row at the bumped version. */
export function deleteArea(env: Env, id: string, actor: Actor): Promise<DeleteOutcome> {
  return inTransaction(env, async (client): Promise<DeleteOutcome> => {
    const version = await softDeleteArea(client, id, actor.userId);
    if (version === null) return { status: 'missing' };
    await writeAudit(client, auditRow(actor, AUDIT.ACTIONS.AREA_DELETE, id, version));
    return { status: 'deleted', version };
  });
}

function auditRow(actor: Actor, action: AuditAction, entityId: string, version: number): AuditRow {
  const { userId, ip, userAgent } = actor;
  return { userId, action, entity: AUDIT.ENTITIES.AREA, entityId, version, ip, userAgent };
}

/**
 * Runs `fn` in one Drizzle transaction on a fresh client; the spatial helpers get that same
 * client, so their statements run inside it, and any error rolls everything back and propagates.
 * READ COMMITTED (Postgres' default, spelled out) is what `updateAreaIfVersion` relies on: its
 * re-read after a lost race sees the winner's commit. Hyperdrive pools in transaction mode, so the
 * whole transaction stays on one server connection.
 */
function inTransaction<T>(env: Env, fn: (client: pg.Client) => Promise<T>): Promise<T> {
  return withClient(env, (client) =>
    db(client).transaction(() => fn(client), { isolationLevel: 'read committed' }),
  );
}

/** A write PostGIS refused (`InvalidGeometryError`, already rolled back) as `{ status: 'invalid' }`. */
async function orInvalid<T>(write: Promise<T>): Promise<T | Invalid> {
  try {
    return await write;
  } catch (err) {
    if (err instanceof InvalidGeometryError) return { status: 'invalid', reason: err.reason };
    throw err;
  }
}
