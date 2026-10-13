# Testing: the mechanics

What kinds of tests exist and their counts are in the [README](../README.md#testing). This page is the how.

## Day to day

```bash
pnpm test                                                  # shared, web (jsdom), api (workerd, against the local PostGIS)
pnpm lint && pnpm format:check && pnpm typecheck && pnpm constants:docs --check
pnpm --filter @cgis/web test:storybook                     # every story in headless Chromium: render, play, a11y
pnpm --filter @cgis/web storybook                          # design system on :6006
pnpm e2e                                                   # two browsers against wrangler dev + Vite
pnpm --filter @cgis/api exec wrangler deploy --dry-run --env production   # after a change to the api
```

The api tests need a migrated local PostGIS (`pnpm db:up`); they create and migrate their own lane databases (below). The e2e run needs Chromium once per machine: `pnpm --filter @cgis/web exec playwright install chromium`. `pnpm e2e --project chromium` skips the aerial spec, which loads govmap tiles from the internet.

## Lane databases

Every api test database is named `<base>_<lane>` (`cgis_auth_<lane>`, `cgis_api_<lane>`, `cgis_db_<lane>`, ...), where the lane is `CGIS_TEST_LANE` or, unset, the current git branch (`feat/history` → `cgis_api_feat_history`). Worktrees on different branches share the one compose PostGIS without resetting each other's databases; set `CGIS_TEST_LANE` to run two checkouts of one branch side by side (`apps/api/test/lane.ts`).

On every run, each project's global setup creates its databases with `scripts/db-lane.sh`, empties them and migrates them from scratch: the Node project (`apps/api/test/db`, migrations and seed) uses `cgis_db_<lane>` and `cgis_db_seed_<lane>`; the workerd project (`apps/api/test/lane-setup.ts`) uses five of its own. The e2e run uses `cgis_e2e`.

`scripts/db-lane.sh <name>` is also useful by hand: it creates `<name>` (idempotent) with PostGIS enabled and prints its URL, which `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` or `DATABASE_URL` accepts. `CGIS_LOCAL_DB` overrides the base URL on a machine whose PostGIS listens elsewhere.

## API contract and OpenAPI

`apps/api/batch/areas.jsonl` is a request batch the Hono CLI replays against the Worker on workerd, without a dev server:

```bash
pnpm --filter @cgis/api exec hono batch batch/areas.jsonl --runtime workerd
pnpm --filter @cgis/api exec hono request /readyz --runtime workerd     # one request
```

CI runs the batch. The OpenAPI document is validated in a test (`@readme/openapi-parser`) and served at `/openapi.json`; `/docs` is a hand-written page that renders it with Scalar's pinned standalone build, loaded with Subresource Integrity. `apps/api/AGENTS.md` lists the other Hono CLI commands.

## Storybook browser tests

`apps/web/vite.config.ts` defines two Vitest projects: `unit` (jsdom) and `storybook`, which runs every story as a component test in headless Chromium: render, the `play` function, and the a11y addon at `test: 'error'`, so an accessibility violation fails the run.

## CI

`.github/workflows/ci.yml` on every pull request and push to `main`:

1. `checks`: install, `pnpm lint`, `pnpm format:check`, `pnpm constants:docs --check`, `pnpm typecheck` (the e2e specs included).
2. `ci`: `drizzle-kit generate` with no change to `apps/api/drizzle`, migrate the runner's PostGIS service, `pnpm test`, the contract batch, `pnpm --filter @cgis/web build`, `build-storybook`, and `wrangler deploy --dry-run --env production`.
3. `e2e`: Playwright Chromium, the Storybook browser tests, then `pnpm e2e` (the `chromium` project only; the aerial project needs the internet).

Load tests (`pnpm bench`, k6) stay manual: [`../bench/README.md`](../bench/README.md), results in [`benchmarks-load.md`](benchmarks-load.md).
