import { sql } from 'drizzle-orm';
import {
  bigserial,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { polygon } from './geometry.ts';

// Column names are spelled out in snake_case: the Drizzle client (./index.ts) and drizzle-kit
// (../../drizzle.config.ts) set no `casing`, so a bare `areaId: uuid()` would become "areaId".

/** Current state of every area; `deleted_at` marks a soft delete. */
export const areas = pgTable(
  'areas',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    geom: polygon('geom').notNull(),
    areaKm2: numeric('area_km2', { precision: 14, scale: 6, mode: 'number' }).notNull(),
    version: integer('version').notNull().default(1),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  // Viewport queries only ever read live areas, so the spatial index skips soft-deleted ones.
  (t) => [
    index('areas_geom_gist')
      .using('gist', t.geom)
      .where(sql`${t.deletedAt} is null`),
  ],
);

/** One row per saved version of an area: the area as it stood at `version`. */
export const areaVersions = pgTable(
  'area_versions',
  {
    areaId: uuid('area_id')
      .notNull()
      .references(() => areas.id),
    version: integer('version').notNull(),
    name: text('name').notNull(),
    geom: polygon('geom').notNull(),
    areaKm2: numeric('area_km2', { precision: 14, scale: 6, mode: 'number' }).notNull(),
    changedBy: text('changed_by').notNull(),
    changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.areaId, t.version] })],
);

/**
 * Append-only record of who did what (D20): `action` and `entity` (the entity type) from `AUDIT` in
 * @cgis/shared. An area event's `(entity_id, version)` points at the `area_versions` row it
 * produced, instead of hashing the request body; `version` is NULL for events that have no
 * versioned entity. `details` holds an event's own facts (e.g. the retention purge's deleted
 * counts, a rejection's code), never a request body. `request_id` is the request's
 * `x-request-id`; NULL for events no HTTP request carried (Room draw sessions, the purge).
 */
export const auditLog = pgTable('audit_log', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  userId: text('user_id'),
  action: text('action').notNull(),
  entity: text('entity').notNull(),
  entityId: text('entity_id'),
  version: integer('version'),
  ip: text('ip'),
  userAgent: text('user_agent'),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  details: jsonb('details').$type<Record<string, unknown>>(),
  requestId: text('request_id'),
});
