# Load test results (k6)

Scripts and how to run them: `bench/README.md`. One run of each script, 2026-10-12, defaults
unless stated.

## Setup

| Item     | Value                                                                                                  |
| -------- | ------------------------------------------------------------------------------------------------------ |
| Machine  | Apple M4 Pro, 12 cores, 48 GB RAM, macOS 26.3 (25D125); load average 7.8 at start (other work running) |
| Code     | `m1/integration` at `ca4b2bb`                                                                          |
| k6       | v2.3.0 (Homebrew), same machine as the Worker                                                          |
| Worker   | `wrangler dev --port 8787` from `apps/api`, wrangler 4.149.0, workerd 1.20261006.1                     |
| Database | PostGIS 3.6.1 on PostgreSQL 18.1 (`imresamu/postgis:18-3.6`, Docker 29.3.0), local Hyperdrive          |
| Data     | Separate database `cgis_load`, migrated, tables emptied before the REST run (0 areas, 0 users)         |

## REST (`k6 run bench/rest.js`)

10 VUs, 1 min, constant VUs. Each VU: one sign-up, then per iteration 4 viewport reads
(`GET /api/areas?bbox=…&zoom=…`, zoom 8, 12, 13, 14) and 1 area create (`POST /api/areas`),
paced to 40 creates per VU per minute.

| Metric                              | Value                                                                                  |
| ----------------------------------- | -------------------------------------------------------------------------------------- |
| Requests                            | 2010 (10 sign-ups, 1600 reads, 400 writes), 33.2 req/s                                 |
| Iterations                          | 400                                                                                    |
| Read p50 / p95 / max                | 54.64 ms / 79.10 ms / 113.66 ms                                                        |
| Write p50 / p95 / max               | 78.56 ms / 113.40 ms / 135.54 ms                                                       |
| All requests p50 / p95              | 57.86 ms / 95.09 ms (max 534.64 ms)                                                    |
| Error rate                          | 0.00 % (0 of 2010)                                                                     |
| 429 responses                       | 0                                                                                      |
| Checks                              | 4010 of 4010 passed                                                                    |
| Areas in the database after the run | 400                                                                                    |
| Thresholds                          | p95 read < 300 ms: pass · p95 write < 600 ms: pass · no 429: pass · errors < 1 %: pass |

## WebSocket (`k6 run bench/ws.js`)

5 VUs, one socket each, all in the `default` room. Each VU sent 300 `draft:update` frames
(10 per second for 30 s) after every VU appeared in presence, then listened 3 s more.

| Metric                                         | Value                                     |
| ---------------------------------------------- | ----------------------------------------- |
| Frames sent                                    | 1500 (300 per VU)                         |
| Echoes received from other VUs                 | 6000 (each frame at each of the 4 others) |
| Echo ratio, (frame, other VU) pairs within 1 s | 100.00 % (6000 of 6000)                   |
| Echo delay p50 / p95 / p99 / max               | 3 ms / 3 ms / 4 ms / 19 ms (whole ms)     |
| `error` frames from the Room                   | 0                                         |
| Sign-up p50 (5 requests)                       | 269.88 ms                                 |
| WebSocket connect p50 / max                    | 16.41 ms / 18.04 ms                       |
| Error rate (HTTP)                              | 0.00 % (0 of 5)                           |
| Checks                                         | 20 of 20 passed                           |
| Threshold                                      | ≥ 95 % echoed within 1 s: pass            |

Every frame reached every other VU within 1 s, so the share of frames echoed to at least one
other VU within 1 s was also 100 %.
