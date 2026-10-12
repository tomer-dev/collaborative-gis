#!/usr/bin/env bash
set -euo pipefail
# Deliberately the in-container port 5432: psql runs inside the container (5433 is host-side).
URL="${1:-postgresql://cgis:cgis@localhost:5432/cgis}"
docker compose exec -T postgis psql "$URL" -v ON_ERROR_STOP=1 -c "create extension if not exists postgis;" -c "select postgis_version();"
