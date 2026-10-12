# End-to-end tests

Two browser contexts on one map (`collaboration.spec.ts`), against the real Worker and SPA. `layer-switch.spec.ts` checks that switching to govmap's aerial layer keeps the centre, a saved polygon and a draft in place; it loads govmap's tiles, so it needs the internet.

The two are separate Playwright projects: `chromium` (every spec but the layer switch) and `aerial` (the layer switch). CI (the `e2e` job in `.github/workflows/ci.yml`) runs `chromium` only, since `CI` is set there; locally `pnpm e2e` runs both, and `pnpm e2e --project chromium` skips the internet. `pnpm typecheck` covers these files (`tsc -p e2e` in the web package).

## Running

1. Start the local PostGIS with `pnpm db:up`. The run creates, empties and migrates its own `cgis_e2e` lane database.
2. Once per machine: `pnpm --filter @cgis/web exec playwright install chromium`.
3. From the repo root, `pnpm e2e` typechecks the specs, starts `wrangler dev` (8787) and Vite (5173), runs Chromium and stops both servers. Both ports must be free.
4. If a port is taken by something else, move the run: `E2E_API_PORT=8788 E2E_WEB_PORT=5174 pnpm e2e` (Vite's proxy and the Worker's `CLIENT_ORIGIN` follow).
5. A failed run keeps its trace in `apps/web/node_modules/.e2e-results/`; open it with `pnpm --filter @cgis/web exec playwright show-trace <path to trace.zip>`.
