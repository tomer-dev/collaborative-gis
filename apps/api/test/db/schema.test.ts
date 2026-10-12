import { readFileSync } from 'node:fs';
import type { Polygon } from '@cgis/shared';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { migrate } from '../../src/db/migrate';
import * as schema from '../../src/db/schema';
import { areas } from '../../src/db/schema';

const url = inject('databaseUrl');
const client = new pg.Client({ connectionString: url });

beforeAll(() => client.connect());
afterAll(() => client.end());

async function query<T>(text: string, values: unknown[] = []): Promise<T[]> {
  return (await client.query(text, values)).rows as T[];
}

/** One line per column: `name type not null|null [default …]`, in table order. */
async function columns(table: string): Promise<string[]> {
  const rows = await query<{ name: string; type: string; not_null: boolean; def: string | null }>(
    `select a.attname as name, format_type(a.atttypid, a.atttypmod) as type, a.attnotnull as not_null,
            pg_get_expr(d.adbin, d.adrelid) as def
       from pg_attribute a
       left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
      where a.attrelid = $1::regclass and a.attnum > 0 and not a.attisdropped
      order by a.attnum`,
    [table],
  );
  return rows.map((r) =>
    [r.name, r.type, r.not_null ? 'not null' : 'null', r.def && `default ${r.def}`]
      .filter(Boolean)
      .join(' '),
  );
}

/** Key and check constraints; NOT NULL (a pg_constraint row since PostgreSQL 18) is in columns(). */
async function constraints(table: string): Promise<string[]> {
  const rows = await query<{ def: string }>(
    "select pg_get_constraintdef(oid) as def from pg_constraint where conrelid = $1::regclass and contype <> 'n' order by contype, conname",
    [table],
  );
  return rows.map((r) => r.def);
}

const appliedMigrations = () =>
  query<{ id: number; hash: string; created_at: string }>(
    'select id, hash, created_at from drizzle.__drizzle_migrations order by id',
  );

describe('migrations', () => {
  it('install PostGIS (0000_postgis.sql) into a database without it', async () => {
    const [row] = await query<{ version: string }>('select postgis_version() as version');
    expect(row?.version).toMatch(/^3\.\d+ /);
  });

  it('record every journal entry in drizzle.__drizzle_migrations', async () => {
    const journal = JSON.parse(
      readFileSync(new URL('../../drizzle/meta/_journal.json', import.meta.url), 'utf8'),
    ) as { entries: { tag: string }[] };
    expect(journal.entries[0]?.tag).toBe('0000_postgis');
    expect(await appliedMigrations()).toHaveLength(journal.entries.length);
  });

  it('are a no-op when run again', async () => {
    const tables = async () => [
      await columns('areas'),
      await columns('area_versions'),
      await columns('audit_log'),
    ];
    const before = { migrations: await appliedMigrations(), tables: await tables() };
    await migrate(url);
    expect({ migrations: await appliedMigrations(), tables: await tables() }).toEqual(before);
  });
});

describe('areas', () => {
  it('has the planned columns, geom as geometry(Polygon,4326)', async () => {
    expect(await columns('areas')).toEqual([
      'id uuid not null default gen_random_uuid()',
      'name text not null',
      'geom geometry(Polygon,4326) not null',
      'area_km2 numeric(14,6) not null',
      'version integer not null default 1',
      'created_by text not null',
      'created_at timestamp with time zone not null default now()',
      'updated_at timestamp with time zone not null default now()',
      'deleted_at timestamp with time zone null',
    ]);
    expect(await constraints('areas')).toEqual(['PRIMARY KEY (id)']);
  });

  it('has a GiST index on geom over live rows only', async () => {
    const rows = await query<{ indexdef: string }>(
      "select indexdef from pg_indexes where schemaname = 'public' and indexname = 'areas_geom_gist'",
    );
    expect(rows.map((r) => r.indexdef)).toEqual([
      'CREATE INDEX areas_geom_gist ON public.areas USING gist (geom) WHERE (deleted_at IS NULL)',
    ]);
  });

  it('writes geom from GeoJSON through Drizzle, stored with SRID 4326', async () => {
    const orm = drizzle(client, { schema });
    const square: Polygon = {
      type: 'Polygon',
      coordinates: [
        [
          [34.78, 32.08],
          [34.79, 32.08],
          [34.79, 32.09],
          [34.78, 32.09],
          [34.78, 32.08],
        ],
      ],
    };
    const [inserted] = await orm
      .insert(areas)
      .values({ name: 'square', geom: square, areaKm2: 0.9, createdBy: 'user-1' })
      .returning({
        id: areas.id,
        name: areas.name,
        areaKm2: areas.areaKm2,
        version: areas.version,
      });
    try {
      expect(inserted).toMatchObject({ name: 'square', areaKm2: 0.9, version: 1 });
      // Raw geom reads throw by design (see geometry.ts); GeoJSON comes back via ST_AsGeoJSON.
      const [stored] = await orm
        .select({
          srid: sql<number>`ST_SRID(${areas.geom})`,
          geom: sql<Polygon>`ST_AsGeoJSON(${areas.geom})::json`,
        })
        .from(areas)
        .where(eq(areas.id, inserted!.id));
      expect(stored).toEqual({ srid: 4326, geom: square });
    } finally {
      await orm.delete(areas).where(eq(areas.id, inserted!.id));
    }
  });
});

describe('area_versions', () => {
  it('has the planned columns, keyed by (area_id, version) and referencing areas', async () => {
    expect(await columns('area_versions')).toEqual([
      'area_id uuid not null',
      'version integer not null',
      'name text not null',
      'geom geometry(Polygon,4326) not null',
      'area_km2 numeric(14,6) not null',
      'changed_by text not null',
      'changed_at timestamp with time zone not null default now()',
    ]);
    expect(await constraints('area_versions')).toEqual([
      'FOREIGN KEY (area_id) REFERENCES areas(id)',
      'PRIMARY KEY (area_id, version)',
    ]);
  });
});

describe('audit_log', () => {
  it('has the planned columns', async () => {
    expect(await columns('audit_log')).toEqual([
      "id bigint not null default nextval('audit_log_id_seq'::regclass)",
      'user_id text null',
      'action text not null',
      'entity text not null',
      'entity_id text null',
      'ip text null',
      'user_agent text null',
      'payload_hash text null',
      'at timestamp with time zone not null default now()',
    ]);
    expect(await constraints('audit_log')).toEqual(['PRIMARY KEY (id)']);
  });
});
