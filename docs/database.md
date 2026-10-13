# Database: migrations, seed and access rules

## Migrations

Migrations always run against a **direct** database URL, never through Hyperdrive. Hyperdrive is the Worker's runtime path only: the Worker reaches the database solely through the `HYPERDRIVE` binding.

- Schema: `apps/api/src/db/schema.ts` (areas, area versions, audit log) and `apps/api/src/db/auth-schema.ts` (Better Auth). After changing either, run `pnpm --filter @cgis/api db:generate`. It writes the next `apps/api/drizzle/NNNN_*.sql`; commit that file together with `drizzle/meta`. `0000_postgis.sql` is hand-written: `create extension if not exists postgis`.
- Apply: `DATABASE_URL=<direct URL> pnpm --filter @cgis/api db:migrate`. Applied migrations are recorded in `drizzle.__drizzle_migrations`, so a rerun is a no-op.
- Locally, the direct URL is `postgresql://cgis:cgis@127.0.0.1:5433/cgis`; migrate it before running the workerd tests that need tables. A lane database from `scripts/db-lane.sh` works the same way.
- In production, use the Neon direct (non-pooled) URL (`NEON_DATABASE_URL` in `.env.example`), injected from 1Password with `op run`. CI migrates Neon before every deploy, and the runner's PostGIS before `pnpm test`.
- CI also runs `drizzle-kit generate` and fails when `apps/api/drizzle` changes: the migrations must match the schema.
- `apps/api/test/db` is a Node Vitest project (`db` in `apps/api/vitest.config.ts`), because `migrate()` reads the SQL files from disk. On every run, its global setup creates `cgis_db_<lane>` and `cgis_db_seed_<lane>` with `scripts/db-lane.sh`, empties them and migrates them from scratch; the workerd project's global setup (`apps/api/test/lane-setup.ts`) does the same for its five lane databases.

## Seed and benchmark

- `DATABASE_URL=<direct URL> pnpm --filter @cgis/api db:seed [--count N]` tops the random `seed-*` polygons (created by the `seed` user) up to N (default 50; `--count 10000` for the benchmark set), so a rerun adds nothing.
- `pnpm --filter @cgis/api db:explain` seeds 10,000 and writes the bounds-query EXPLAIN table to [`benchmarks.md`](benchmarks.md).

## Coordinate order

All GeoJSON in this project is `[longitude, latitude]`; Leaflet's own API is `[lat, lng]`. The shared schema cannot detect a swap when both values are in range.

## Access rules

- Reads use the Drizzle query builder with explicit column lists; geometry leaves the database only as `ST_AsGeoJSON(geom)::json` (the `polygon` column type refuses raw reads).
- `sql` is for PostGIS fragments (`ST_MakeEnvelope`, `ST_Area`, `ST_GeomFromGeoJSON`) and for the write CTEs in `apps/api/src/db/spatial.ts` that write an area and its version row in one statement (each marked in a comment); ESLint rejects a `sql` template starting with `SELECT` in `apps/api/src`.
- Rows from those raw statements are Zod-parsed before they leave `spatial.ts`; the Worker reaches the database only through `withClient` (Hyperdrive), scripts and migrations through a direct URL.
- Geodesic area is `ST_Area(geom::geography)` on every write, stored with the row and each version, so reads never compute it.
- Soft delete: `deleted_at` hides an area from the map; a daily cron (`RETENTION.CRON`) purges rows older than `RETENTION.DAYS` (7) with their versions. The purge is idempotent.
