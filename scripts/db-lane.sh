#!/usr/bin/env bash
# Creates (once) a per-lane test database with PostGIS on the local compose PostGIS and prints its URL.
# Idempotent: rerunning reuses the database. Only the URL goes to stdout; psql chatter goes to stderr.
#
# Usage: bash scripts/db-lane.sh <name>        e.g. cgis_db, cgis_auth, cgis_api, cgis_room
#   CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE="$(bash scripts/db-lane.sh cgis_db)" \
#     pnpm --filter @cgis/api test
set -euo pipefail

name="${1:-}"
if [[ ! "$name" =~ ^[a-z_][a-z0-9_]{0,62}$ ]]; then
  echo "usage: $0 <name>  (lowercase letters, digits and _; e.g. cgis_db)" >&2
  exit 2
fi

# Local docker-compose credentials only (docker-compose.yml); never point this at Neon.
base="postgresql://cgis:cgis@127.0.0.1:5433"
export PGOPTIONS='-c client_min_messages=warning'

exists() {
  psql "$base/cgis" -v ON_ERROR_STOP=1 -tAc "select 1 from pg_database where datname = '$name'"
}

if [[ "$(exists)" != 1 ]]; then
  # A concurrent run may win the race; that is fine as long as the database exists afterwards.
  psql "$base/cgis" -v ON_ERROR_STOP=1 -q -c "create database \"$name\"" >&2 || [[ "$(exists)" == 1 ]]
fi
psql "$base/$name" -v ON_ERROR_STOP=1 -q -c 'create extension if not exists postgis' >&2

echo "$base/$name"
