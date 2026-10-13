# Load test results (k6)

Scripts and how to run them: `bench/README.md`. One run of each script, 2026-10-13, defaults
unless stated. The setup below is the REST run's; the WebSocket run states its own differences.

## Setup

| Item     | Value                                                                                                     |
| -------- | --------------------------------------------------------------------------------------------------------- |
| Machine  | Apple M4 Pro, 12 cores, 48 GB RAM, macOS 26.3 (25D125); load average 7.2 at start (other work running)    |
| Code     | `m3/load-test` at `39bc2f1` (`m2/realtime-limits` merged in) with the `ws.js` defaults of the next commit |
| k6       | v2.3.0 (Homebrew), same machine as the Worker                                                             |
| Worker   | `wrangler dev --port 8787` from `apps/api`, wrangler 4.149.0, workerd 1.20261006.1                        |
| Database | PostGIS 3.6.1 on PostgreSQL 18.1 (`imresamu/postgis:18-3.6`, Docker 29.3.0), local Hyperdrive             |
| Data     | Separate database `cgis_load`, migrated, tables emptied before the REST run (0 areas, 0 users)            |

## REST (`k6 run bench/rest.js`)

10 VUs, 1 min, constant VUs. Each VU: one sign-up, then per iteration 4 viewport reads
(`GET /api/areas?bbox=…&zoom=…`, zoom 8, 12, 13, 14) and 1 area create (`POST /api/areas`),
paced to 40 creates per VU per minute.

| Metric                              | Value                                                                                  |
| ----------------------------------- | -------------------------------------------------------------------------------------- |
| Requests                            | 2010 (10 sign-ups, 1600 reads, 400 writes), 33.1 req/s                                 |
| Iterations                          | 400                                                                                    |
| Read p50 / p95 / max                | 50.83 ms / 86.34 ms / 217.25 ms                                                        |
| Write p50 / p95 / max               | 68.15 ms / 131.78 ms / 278.36 ms                                                       |
| All requests p50 / p95              | 54.11 ms / 102.89 ms (max 613.61 ms)                                                   |
| Error rate                          | 0.00 % (0 of 2010)                                                                     |
| 429 responses                       | 0                                                                                      |
| Checks                              | 4010 of 4010 passed                                                                    |
| Areas in the database after the run | 400                                                                                    |
| Thresholds                          | p95 read < 300 ms: pass · p95 write < 600 ms: pass · no 429: pass · errors < 1 %: pass |

## WebSocket (`k6 run bench/ws.js`)

Run 2026-10-13 on `m2/draft-session-budget` (the D5 draft-session change on `m2/integration` at
`4c3a857`), same machine and versions as above; load average 5.86 at start. The Worker ran as
`wrangler dev --port 8797` on its own migrated database `cgis_load_d5` (empty), with
`-e BASE_URL=http://localhost:8797`; every other value is the script's default.

5 VUs, one socket each, all in the `default` room. Each VU sent 300 `draft:update` frames
(10 per second, the Room's per-socket limit, for 30 s: one `add`, then `move`s) after every VU
appeared in presence, then listened 3 s more. Since D5's ruling (2026-10-13) a frame is not a
drawing action: each VU's frames are one draft session, which spends one action of the user's
50 per minute.

| Metric                                         | Value                                     |
| ---------------------------------------------- | ----------------------------------------- |
| Frames sent                                    | 1500 (300 per VU)                         |
| Echoes received from other VUs                 | 6000 (each frame at each of the 4 others) |
| Echo ratio, (frame, other VU) pairs within 1 s | 100.00 % (6000 of 6000)                   |
| Echo delay p50 / p95 / p99 / max               | 3 ms / 8 ms / 15 ms / 31 ms (whole ms)    |
| `error` frames from the Room                   | 0                                         |
| Sign-up p50 (5 requests)                       | 347.26 ms                                 |
| WebSocket connect p50 / max                    | 34.25 ms / 37.08 ms                       |
| Error rate (HTTP)                              | 0.00 % (0 of 5)                           |
| Checks                                         | 20 of 20 passed                           |
| Threshold                                      | ≥ 95 % echoed within 1 s: pass            |

Every frame reached every other VU within 1 s, so the share of frames echoed to at least one
other VU within 1 s was also 100 %.

The previous run, on `m3/load-test` at `39bc2f1` while every frame spent one action, sent 1.5
frames per second for 30 s (45 per VU, under the budget) and measured 900 of 900 pairs within
1 s (delay p95 10 ms). At 10 frames per second for 8 s (2 VUs) that code accepted 50 frames per
user and answered the other 30 with `error RATE_LIMITED` (echo ratio 62.5 %).

An earlier run on `m1/integration` at `ca4b2bb`, before the per-user drawing budget existed, sent
10 frames per second for 30 s (1500 frames) and measured 6000 of 6000 pairs echoed within 1 s
(delay p95 3 ms). REST on that code measured read p95 79.10 ms and write p95 113.40 ms.
