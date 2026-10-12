# ADR-0004: Horizontal scaling on Cloudflare

Date: 2026-10-12 · Status: accepted · Ticket: TOM-41 (roadmap 4.9)

## Context
The brief asks: "how would you handle multiple server instances?" On a classic stack that question means sticky sessions, a pub/sub bus so a write on instance A reaches sockets on instance B, and a shared store for rate-limit counters, because every instance owns its own sockets and memory.

Our stack (ADR-0001, spec §2) is one deployable Worker:

- a Hono app for REST, auth, validation and caching;
- a `Room` Durable Object (DO) per map using the WebSocket Hibernation API, the single coordinator for presence, draft broadcast and `area:*` fan-out;
- a `RateLimiter` DO per user (exact sliding window, 50 drawing actions / 60 s, shared by REST and WS);
- Hyperdrive to Neon PostGIS;
- the Cache API for bounds responses, with version-stamped keys bumped by the Room DO;
- a Cron Trigger for the retention purge;
- the Vite SPA as static assets from the same Worker.

Decisions in force: exact per-user DO limiter (D5); version-stamped cache keys (D6); one DO per map, tile sharding documented here only (D7); no Node port (D9); multi-region room sharding, Queues for audit batching and OpenTelemetry export kept as design notes (D14). There is one shared map, room id `default` (D11), so today the Room DO coordinates realtime for the whole app. This ADR states where state lives, the ceiling of each piece, and what changes, in order, if one map outgrows one object.

## Decision
Workers are the stateless tier and Cloudflare runs as many isolates as traffic needs; nothing we deploy has an instance count. Coordination state lives in exactly two places: Durable Objects (sockets, presence, drafts, the per-map version counter, rate-limit windows) and Postgres (areas, versions, audit, auth). The Worker never holds state between requests (spec §3).

- **One `Room` DO per map is the coordinator.** `env.ROOM.getByName(mapId)` sends every isolate in every data center to the same single-threaded object, so all sockets for a map are attached to it. Fan-out is a loop over `ctx.getWebSockets()`; a REST write reaches peers through one RPC `broadcast(event)` in `ctx.waitUntil`. There is no second instance to synchronise, so there is no pub/sub, no sticky session and no Redis. Presence lives in socket attachments, which survive hibernation.
- **One `RateLimiter` DO per user** (`getByName(userId)`) holds the exact 50-actions-per-60-s sliding window shared by REST mutations and WS `draft:update` frames (D5). Objects are keyed by user, so the limiter scales out with the user count and no object sees more than one user's traffic.
- **Hyperdrive** keeps the origin connection pool in regions close to Neon, in transaction mode, so short-lived isolates never open their own Postgres connections; each request creates a `pg` client. Its query cache is **disabled** for our config (`wrangler hyperdrive update <id> --caching-disabled`, applied with ticket 3.6): it is on by default with `max_age` 60 s and writes do not invalidate it, so a Cache API miss right after a write could store pre-write rows under the new version key.
- **Cache API** stores bounds responses per data center under keys made of the quantised tile and the map version counter (D6). A write bumps the counter in the Room DO, so every colo misses on its next read without a purge; old keys expire by TTL.
- **Cron Trigger** runs the retention purge, which is idempotent, so a retry or overlap is harmless.
- **Static assets** are served without invoking the Worker, except the `run_worker_first` paths (`/api/*`, `/ws`).

### Platform limits (checked 2026-10-12)

| Resource | Limit | Source |
|---|---|---|
| Worker requests | Scale automatically; "no general limit on requests per second" | [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) |
| Worker outbound connections | 6 waiting for response headers per invocation; subrequests 50 (Free) / 10,000 (Paid) | [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) |
| DO throughput | Soft limit 1,000 requests/s per object; excess is queued, then fails with an overloaded error | [DO limits](https://developers.cloudflare.com/durable-objects/platform/limits/) |
| DO CPU | 30 s per request by default, configurable to 5 min; each HTTP request or WebSocket message resets it | [DO limits](https://developers.cloudflare.com/durable-objects/platform/limits/) |
| DO storage | 10 GB per SQLite-backed object; number of objects unlimited | [DO limits](https://developers.cloudflare.com/durable-objects/platform/limits/) |
| DO WebSockets | 32,768 hibernatable sockets per object; CPU and memory may lower the practical number | [DO state API](https://developers.cloudflare.com/durable-objects/api/state/) |
| Socket attachment | 16,384 bytes serialised per socket | [DO WebSockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/) |
| Hyperdrive | ~20 (Free) / ~100 (Paid) origin connections per config; 60 s max query | [Hyperdrive limits](https://developers.cloudflare.com/hyperdrive/platform/limits/) |
| Hyperdrive cache | On by default, `max_age` 60 s, not invalidated by writes | [Query caching](https://developers.cloudflare.com/hyperdrive/concepts/query-caching/) |
| Cache API | Contents stay in the originating data center; `cache.delete` purges only that data center; `cache.put` is not tiered | [Cache API](https://developers.cloudflare.com/workers/runtime-apis/cache/) |
| Static assets | "Requests to static assets are free and unlimited" | [Assets billing](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/) |

### Hibernation cost model

| Item | Rule | Source |
|---|---|---|
| Requests | HTTP, RPC sessions, WebSocket messages and alarms; incoming WebSocket messages billed at 20:1 | [DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) |
| Not billed | Outgoing WebSocket messages and incoming protocol pings | [DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) |
| Duration | GB-s on the full 128 MB allocation while active; idle objects eligible for hibernation are not billed | [DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) |
| Heartbeats | `setWebSocketAutoResponse` replies without waking hibernated sockets | [DO state API](https://developers.cloudflare.com/durable-objects/api/state/) |

Cost therefore follows messages received, not connected viewers or fan-out width. A room of idle tabs whose heartbeats are auto-answered accrues no duration; a user drafting at the D13 cap of 10 frames/s is 0.5 billed requests/s.

### Per-map budget
Counted against the 1,000 requests/s soft limit, conservatively:

- every incoming WS frame (`join`, `draft:update`, presence);
- every `broadcast` RPC after a REST write;
- the version-counter read on every `GET /areas`, because the cache key needs it, hit or miss.

The docs note that throughput depends on the work done per request; our handlers validate with Zod and call the `RateLimiter`, so the number measured by the k6 run (ticket 6.6) replaces the documented one. The tighter ceiling is fan-out CPU: each draft frame is sent to every other socket, so 20 users drafting at 10 frames/s among 120 sockets is 200 frames/s in and about 24,000 sends/s out. Per-sender throttling, deltas only and stale-`seq` drops (ticket 4.4) keep that bounded.

## Growth path
Each step is independent and triggered by a measurement, not a date. None is built now (D7, D14).

1. **Shard rooms by tile (D7).** Trigger: overloaded errors from the Room, p95 broadcast latency or CPU per event in Workers Logs. The shard key is `${mapId}/${z}/${x}/${y}` at one fixed shard zoom. Two routings:
   - *Deterministic*: the Worker computes the tiles from the viewport (WS join) or the polygon bbox (REST write) and calls `getByName(tileKey)` (or `get(idFromName(tileKey))`). No extra hop. A client holds one socket per visible shard, bounded by a minimum zoom for live mode.
   - *Router DO per map*: maps tile to shard, so a hot tile can split into its four children and cold ones merge. One extra lookup per join, cacheable by the client.

   A write is broadcast to every shard whose tile intersects the polygon bbox; clients dedupe by `(id, version)`. The version counter becomes per shard, which fits the tile-quantised cache key of D6 unchanged. Presence becomes "who is viewing this region"; a map-wide count is an aggregate. The `RateLimiter` does not change.
2. **Queues for audit batching and burst smoothing.** Audit rows leave the write transaction: the Worker calls `env.AUDIT.send()` and a consumer inserts each batch in one statement. Limits: 5,000 messages/s per queue, 128 KB per message, batches of up to 100, wait up to 60 s, retention up to 14 days ([Queues limits](https://developers.cloudflare.com/queues/platform/limits/)). Delivery is at least once, so the insert is idempotent on a message id. Area writes stay synchronous because the 409 version check needs them.
3. **Metrics.**
   - Workers Logs is already on (`observability.enabled`).
   - OpenTelemetry export of traces and logs is a dashboard destination plus `observability.traces/logs.destinations` in the wrangler config and a redeploy ([OTel export](https://developers.cloudflare.com/workers/observability/opentelemetry-export/)).
   - Product metrics (room size, draft rate, cache hit ratio) go to Workers Analytics Engine via `writeDataPoint`: up to 250 data points per invocation, 20 blobs, 20 doubles and 1 index each, kept three months ([AE limits](https://developers.cloudflare.com/analytics/analytics-engine/limits/)).
4. **Multi-region.**
   - *Rooms*: a DO is created near the first `get()` and does not move afterwards. Location hints (for example `wnam`, `enam`, `weur`, `eeur`, `apac`, `oc`, `afr`, `me`) are best effort and apply only to that first `get()`; jurisdictions (`eu`, `us`, `fedramp`) are hard constraints ([Data location](https://developers.cloudflare.com/durable-objects/reference/data-location/)). We would set the hint from the map's expected audience instead of leaving placement to whoever connects first; with tile shards each shard gets the hint of its own geography, which is the multi-region room sharding of D14.
   - *Database*: Neon read replicas are same-region only and share the primary's storage, so they add read throughput, not geography; a second region needs a second Neon project with logical replication and read routing in the app ([Neon read replicas](https://neon.com/docs/introduction/read-replicas)).

| Change | Code change | Config change |
|---|---|---|
| Tile sharding (deterministic) | Worker routing, client multi-socket, per-shard version, dedupe | — |
| Router DO | New DO class | `migrations` tag with `new_sqlite_classes` |
| Queues for audit | `send()` call, consumer handler, idempotent insert | `queues.producers` / `queues.consumers` |
| OpenTelemetry export | — | Destination + `observability.*.destinations` |
| Analytics Engine | `writeDataPoint` calls | `analytics_engine_datasets` binding |
| Location hint | `{ locationHint }` on the first `get()` | — |
| Hyperdrive cache off | — | `wrangler hyperdrive update --caching-disabled` |
| Neon read replica | Pick the read binding on GET routes | Replica compute, second Hyperdrive config and binding |

## Consequences
What we accept:
- **Single-object ceiling per map.** With one map (D11) every realtime frame of the app goes through one object. If it is overloaded or restarting, clients fall back to polling (ticket 4.7); REST writes keep working because they go to Postgres and the broadcast is fire-and-forget; bounds reads must skip the cache when the version read fails, or they fail with the Room.
- **Placement near the first user.** The Room is created near whoever connects first and stays there; distant users pay that round trip on every frame until a location hint is set.
- **The version read touches the Room on every bounds request**, so viewport traffic counts against the same per-object budget as realtime traffic.
- **Per-colo cache.** Every data center warms its own cache, and `cache.put` gets no tiered-cache help, so hit ratio depends on traffic per colo.
- **Hyperdrive caching off** means every Cache API miss reaches Neon; the Cache API absorbs the repeats.
- **Platform coupling.** DO semantics have no drop-in equivalent off Cloudflare and there is no Node port (D9).

What we gain:
- No broker, no sticky sessions, no instance count to tune; the same code runs on one isolate or thousands.
- An exact, globally shared rate limit without Redis.
- Cache invalidation without purge calls across data centers.
- Near-zero idle cost thanks to hibernation.
- A growth path that is additive; several steps are configuration only.

## Alternatives rejected

| Option | Why not |
|---|---|
| Node servers (Fastify + `@fastify/websocket`) behind a load balancer + Redis pub/sub | Each instance holds a subset of sockets, so fan-out needs Redis pub/sub, presence needs a shared store and the limiter needs the `@fastify/rate-limit` Redis store; plus process supervision and capacity planning. More infrastructure than the brief warrants, and D9 rules out a Node port. |
| Vercel Functions with WebSockets (public beta) | Connection pinned to one instance and capped at the function max duration (300 s Hobby, 800 s Pro), so clients reconnect constantly and fan-out still needs Redis (ADR-0001). |
| Workers rate-limit binding as the limiter | Local to each Cloudflare location, eventually consistent, period 10 or 60 s, not meant for accurate accounting ([binding docs](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)). Kept only as an optional edge pre-filter (D5). |
| Purging cached bounds on write | `cache.delete` purges only the current data center, so a write would leave stale entries elsewhere; version-stamped keys instead (D6). |
