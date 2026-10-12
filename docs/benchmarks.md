# Benchmarks

<!-- bounds-explain:start -->

## Bounds query: GiST index vs none

`selectAreasInBounds` (`GET /api/areas?bbox=…`, `LIMIT 500`) over the viewport `BENCH.VIEWPORT` = `[34.72, 32.02, 34.88, 32.12]`, with 10,000 live areas in the table (random polygons from `db:seed`). Each plan ran 20 times under `EXPLAIN (ANALYZE, FORMAT JSON)`; the times are the server's `Execution Time` (no network, no planning). Budget: p95 under 100 ms (`BENCH.BOUNDS_P95_MS`), recorded, not asserted.

"Index scans off" runs with `SET LOCAL enable_indexscan = off` and `enable_bitmapscan = off`: `enable_indexscan` alone leaves the bitmap index scan, which is the plan the planner picks here.

| Plan | Scan nodes | Rows returned | p50 (ms) | p95 (ms) | p95 within budget |
| --- | --- | ---: | ---: | ---: | --- |
| Planner default | Bitmap Heap Scan on areas; Bitmap Index Scan on areas_geom_gist | 30 | 0.17 | 0.22 | yes |
| Index scans off | Seq Scan on areas | 30 | 1.18 | 1.33 | yes |

Measured 2026-10-12 with `pnpm --filter @cgis/api db:explain` on: Apple M4 Pro, 12 cores, 48 GB RAM; Darwin 25.3.0 arm64, Node v25.8.1; PostgreSQL 18.1 (Debian 18.1-1.pgdg13+2) on aarch64-unknown-linux-gnu, PostGIS 3.6.1.

<!-- bounds-explain:end -->
