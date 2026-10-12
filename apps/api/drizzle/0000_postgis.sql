-- Hand-written (drizzle-kit generate --custom): every later migration needs the PostGIS types.
-- A no-op where the extension is already enabled (Neon, scripts/db-lane.sh).
create extension if not exists postgis;
