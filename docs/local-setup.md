# Local setup: other arrangements

The shortest path is in the [README](../README.md#run-it-locally). This page covers everything else: ports, environment variables, a database per checkout, the API container in detail, Neon, and the production config on your machine.

## Ports

- `wrangler dev` listens on 8787 and Vite on 5173. Vite proxies `/api` and `/ws` to the Worker, so the SPA and the API share one origin.
- `CLIENT_ORIGIN` in `apps/api/wrangler.jsonc` must be the SPA's origin: the CORS policy, Better Auth's trusted origins and the WebSocket origin gate all read it. If 5173 is taken, run the two servers yourself with the SPA's port in `CLIENT_ORIGIN`:

```bash
pnpm --filter @cgis/api dev --var CLIENT_ORIGIN:http://localhost:<port>
pnpm --filter @cgis/web dev --port <port> --strictPort
```

- The local database listens on 5433 (not 5432, to avoid a local Postgres), bound to 127.0.0.1 only; the image is the community multi-arch `imresamu/postgis:18-3.6`. If 5433 is taken, run the same container on another port and set `CGIS_LOCAL_DB` (base URL without a database), `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` and `DATABASE_URL` to it.

## Environment

- `.env.example` documents the local and Neon variables; `apps/api/.dev.vars.example` the Worker secrets (`BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`). Copy the latter to `apps/api/.dev.vars` (git-ignored) and set `BETTER_AUTH_SECRET` (`openssl rand -base64 32`).
- Locally, the `HYPERDRIVE` binding uses `localConnectionString` from `apps/api/wrangler.jsonc`, which points at the compose database. `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` overrides it.
- `pnpm typecheck` runs `wrangler types`, which writes `apps/api/worker-configuration.d.ts`; the web package's build reads it.

## A database per checkout

`bash scripts/db-lane.sh <name>` creates `<name>` on the compose PostGIS with PostGIS enabled (idempotent) and prints its URL. Use it to keep a worktree, a load test or an experiment away from your dev data:

```bash
LANE=$(bash scripts/db-lane.sh cgis_mywork)
DATABASE_URL="$LANE" pnpm --filter @cgis/api db:migrate
CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE="$LANE" pnpm dev
```

The test suites do this on their own; see [`testing.md`](testing.md).

## API in a container

`docker compose up` starts only PostGIS. `docker compose --profile api up` also builds and runs the API in a container (`apps/api/Dockerfile.dev`, Node 26.11.1 slim) that migrates the compose database and then runs `wrangler dev --ip 0.0.0.0 --port 8787` on workerd, reachable at http://127.0.0.1:8787.

- The database is reached service-to-service (`postgis:5432`) through `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE`.
- Worker secrets come from `apps/api/.dev.vars`, bind-mounted read-only: copy `.dev.vars.example` and set `BETTER_AUTH_SECRET` before the first `up`, or `up` fails loudly.
- The Vite SPA stays on the host and still needs Node, pnpm and `pnpm install`: `pnpm --filter @cgis/web dev` proxies `/api` and `/ws` to the container.
- Rebuild after a dependency or source change with `docker compose --profile api up --build`. Stop both services with `docker compose --profile api down` (plain `pnpm db:down` ignores the profile).
- Durable Object state lives in the container under `apps/api/.wrangler/state` and is lost when it is recreated; the database volume persists.

## Without a dev server: the Hono CLI

`pnpm --filter @cgis/api exec hono request /readyz --runtime workerd` sends one request to the Worker on workerd. `pnpm --filter @cgis/api exec hono batch batch/areas.jsonl --runtime workerd` runs the areas API contract (CI runs it too). `apps/api/AGENTS.md` lists the other commands.

## Neon (production database)

Create the project with `neonctl projects create`, enable PostGIS with `create extension if not exists postgis` over the **direct** connection, create a Hyperdrive config with `wrangler hyperdrive create` (query caching off: writes do not invalidate it), and put its id in `apps/api/wrangler.jsonc`. Migrations always run against the direct URL; the Worker only ever sees the Hyperdrive binding.

This is done: Neon project `winter-credit-61110991` (aws-eu-central-1, PostgreSQL 18 / PostGIS 3.6.4), Hyperdrive config `cgis-neon`. The Neon API key is never stored in the repository; it is injected per command from 1Password with `op run` (see `.env.example`).

## The production config on your machine

The production routing (SPA and API on one origin, served by the Worker instead of Vite) against the compose PostGIS: [`deploy.md`, "Local run of the production config"](deploy.md#local-run-of-the-production-config).
