# Load tests (k6)

Two [k6](https://k6.io) scripts that drive a running API Worker:

- `rest.js`: each VU signs up one user, then loops: one `GET /api/areas?bbox=…&zoom=…` per fixed
  viewport and one `POST /api/areas` (a small valid square) per iteration. Iterations are paced so
  each VU creates at most `WRITES_PER_MIN` areas a minute, under the API's 50 mutations per user per
  minute.
- `ws.js`: each VU signs up one user, opens `/ws` with that session cookie and the SPA `Origin`,
  sends `join`, waits until every VU of the run is in `presence`, then sends `draft:update` frames
  at `FRAMES_PER_SEC` for `SEND_SECONDS` and counts the other VUs' frames it receives. A VU's
  frames are one draft session, which spends one action from the user's 50-per-minute budget
  (D5), so only the Room's 10 frames per second per socket bounds `FRAMES_PER_SEC`. The default
  is 300 frames in 30 s.

`auth.js` is the sign-up both share. Every URL, count, threshold and duration sits in the `CONFIG`
object at the top of each script and can be overridden with `-e NAME=value`.

## Run locally

1. Install k6: `brew install k6`.
2. Start PostGIS and migrate it: `pnpm db:up`, then
   `DATABASE_URL=postgresql://cgis:cgis@localhost:5433/cgis pnpm --filter @cgis/api db:migrate`.
   Each run adds users and areas, so a separate database keeps them out of your dev data:
   `bash scripts/db-lane.sh cgis_load` prints its URL; migrate that URL instead.
3. Create `apps/api/.dev.vars` from `apps/api/.dev.vars.example` (`BETTER_AUTH_SECRET`,
   `BETTER_AUTH_URL=http://localhost:8787`).
4. Start the Worker from `apps/api`: `pnpm exec wrangler dev --port 8787`. With the separate
   database, prefix it with
   `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE=postgresql://cgis:cgis@127.0.0.1:5433/cgis_load`.
5. From the repo root: `pnpm bench` (REST, then WS), or one script at a time:
   `k6 run bench/rest.js`, `k6 run bench/ws.js`. Add `--summary-export out.json` to keep the
   numbers.

k6 exits non-zero when a threshold fails.

## What passes

| Script    | Threshold                                                    | Metric                                             |
| --------- | ------------------------------------------------------------ | -------------------------------------------------- |
| `rest.js` | p95 read < `READ_P95_MS` (300 ms)                            | `http_req_duration{op:read}`                       |
| `rest.js` | p95 write < `WRITE_P95_MS` (600 ms)                          | `http_req_duration{op:write}`                      |
| `rest.js` | no 429 from `/api/areas`                                     | `areas_rate_limited` count == 0, check `never 429` |
| `rest.js` | failed requests < `MAX_ERROR_RATE` (1 %)                     | `http_req_failed`                                  |
| `ws.js`   | ≥ `MIN_ECHO_RATIO` (95 %) of frames echoed within 1 s        | `ws_echo_within_window`                            |
| `ws.js`   | no `error` frame from the Room (`RATE_LIMITED`, ...)         | `ws_error_frames` count == 0                       |
| both      | every check passes (sign-up, statuses, upgrade 101, all VUs) | `checks`                                           |

`ws_echo_within_window` has one sample per (frame, other VU) pair: true when that VU received the
frame within `ECHO_WINDOW_MS` of its send time. VUs share no memory, so each frame carries its own
number and send time in its draft vertex (see `VERTEX` in `ws.js`), and the receiver measures the
delay on the same machine clock. Every frame goes to every other VU, so this ratio is a lower
bound on the share of frames echoed to at least one other VU. A frame the Room rejected or dropped
counts as missed by every other VU. `ws_echo_latency` is the send-to-receive delay in whole ms.

## Environment variables

Shared by both scripts:

| Name           | Default                   | Meaning                                                   |
| -------------- | ------------------------- | --------------------------------------------------------- |
| `BASE_URL`     | `http://localhost:8787`   | The Worker under test                                     |
| `ORIGIN`       | `http://localhost:5173`   | Sent as `Origin`; must equal the Worker's `CLIENT_ORIGIN` |
| `SIGN_UP_PATH` | `/api/auth/sign-up/email` | Better Auth email sign-up                                 |
| `VUS`          | 10 (REST), 5 (WS)         | Virtual users, one account each                           |
| `PASSWORD`     | `load-test-password`      | Password of every generated account                       |
| `RUN_ID`       | `load-<base36 time>`      | Prefix of generated emails, user names and area names     |

`rest.js`:

| Name             | Default        | Meaning                                                                |
| ---------------- | -------------- | ---------------------------------------------------------------------- |
| `AREAS_PATH`     | `/api/areas`   | Areas endpoint                                                         |
| `DURATION`       | `1m`           | Run length (k6 duration)                                               |
| `WRITES_PER_MIN` | 40             | Area creates per VU per minute (paces the loop)                        |
| `VIEWPORTS`      | 4 Israel boxes | JSON `[{ "bbox": [w, s, e, n], "zoom": z }, ...]`, read each iteration |
| `SQUARE_DEG`     | 0.005          | Side of each created square, in degrees                                |
| `READ_P95_MS`    | 300            | Read p95 threshold                                                     |
| `WRITE_P95_MS`   | 600            | Write p95 threshold                                                    |
| `MAX_ERROR_RATE` | 0.01           | Highest share of failed requests                                       |

`ws.js`:

| Name               | Default          | Meaning                                                           |
| ------------------ | ---------------- | ----------------------------------------------------------------- |
| `WS_PATH`          | `/ws`            | WebSocket endpoint                                                |
| `MAP_ID`           | `default`        | `mapId` of the `join` frame                                       |
| `FRAMES_PER_SEC`   | 10               | `draft:update` frames per VU per second (Room: ≤ 10/s per socket) |
| `SEND_SECONDS`     | 30               | How long each VU sends                                            |
| `ECHO_WINDOW_MS`   | 1000             | A frame later than this counts as missed                          |
| `MIN_ECHO_RATIO`   | 0.95             | `ws_echo_within_window` threshold                                 |
| `READY_TIMEOUT_MS` | 15000            | Wait for every VU in presence before giving up                    |
| `LINGER_MS`        | 3000             | Listening time after a VU's last frame                            |
| `VERTEX_ORIGIN`    | `[34.78, 32.08]` | JSON `[lng, lat]` the draft vertices start from                   |

Recorded results: `docs/benchmarks-load.md`.
