# Deploy

One Worker, `collaborative-gis`, serves the built SPA (`apps/web/dist`) as static assets and the API, the WebSocket and both Durable Objects (`Room`, `RateLimiter`) on one origin. Postgres is the Neon project `winter-credit-61110991`, reached through the Hyperdrive config `cgis-neon` (`ffdceaec4c3b4c70a324ebf9da6cb7a9`). Its configuration is `env.production` in `apps/api/wrangler.jsonc`; nothing in the repository is a secret. Checked with wrangler 4.149.0.

Commands run from the repository root. `wrangler` below is the pinned dev dependency: `pnpm --filter @cgis/api exec wrangler …`, signed in with `wrangler login` or with `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in the shell. Deploying needs the Workers Paid plan: Better Auth's scrypt hashing exceeds the Free plan's CPU limit (D21).

## Routing

- `/api/*`, `/ws`, `/healthz`, `/readyz`, `/docs` and `/openapi.json` always reach the Worker (`assets.run_worker_first`), so an unknown API path is the Worker's JSON 404, never the SPA.
- Any other path is a built file when one matches, else `index.html` (`not_found_handling: "single-page-application"`), so `/map` and `/login` load the SPA.

## Top level and `env.production`

The top level of `wrangler.jsonc` is the local setup (`wrangler dev`, the workerd tests, `hono batch`). `env.production` inherits `main`, the compatibility date and flags, `observability`, the Durable Object `migrations` and any `triggers`; bindings, vars and secrets are never inherited, so it repeats them. `pnpm typecheck` fails when one side gains a binding the other lacks (`apps/api/test/deploy-config.test.ts`).

| | Top level (local) | `env.production` |
|---|---|---|
| Worker | `collaborative-gis-api`, never deployed | `collaborative-gis` |
| Static assets | none: Vite serves the SPA on :5173 and proxies `/api`, `/ws` | `../web/dist` (build it first) |
| `CLIENT_ORIGIN` | var, `http://localhost:5173` | var, the deployed origin |
| `BETTER_AUTH_URL` | `.dev.vars` | var, the deployed origin |
| `BETTER_AUTH_SECRET` | `.dev.vars` | Worker secret |
| `HYPERDRIVE` | `localConnectionString`, the compose PostGIS | `cgis-neon` |

Never run `wrangler deploy` without `--env production`: the top level would create a second Worker, `collaborative-gis-api`, with localhost origins.

## Owner checklist (once)

1. **Hyperdrive query caching off** (ADR-0004: writes do not invalidate it). `update` takes the config id, not the name `cgis-neon`; `get` shows the result.
   ```bash
   pnpm --filter @cgis/api exec wrangler hyperdrive update ffdceaec4c3b4c70a324ebf9da6cb7a9 --caching-disabled
   pnpm --filter @cgis/api exec wrangler hyperdrive get ffdceaec4c3b4c70a324ebf9da6cb7a9
   ```
2. **Migrate Neon** over its direct (non-pooled) URL; reruns are no-ops, and CI repeats it before every deploy.
   ```bash
   DATABASE_URL='<Neon direct URL>' pnpm --filter @cgis/api db:migrate
   ```
3. **Production origin.** In `apps/api/wrangler.jsonc` `env.production.vars`, replace `REPLACE-WITH-ACCOUNT-SUBDOMAIN` in `CLIENT_ORIGIN` and `BETTER_AUTH_URL` with the account's workers.dev subdomain (Cloudflare dashboard, Workers & Pages), giving `https://collaborative-gis.<subdomain>.workers.dev`: https, no trailing slash, the same value in both. The CORS policy, Better Auth's trusted origins and the WebSocket origin gate compare against `CLIENT_ORIGIN`; an https `BETTER_AUTH_URL` turns on `Secure` `__Secure-` cookies. Merge it to `main`; the deploy workflow refuses to run while the placeholder is there. For a custom domain, add a `routes` entry with `custom_domain: true` to `env.production` and use that origin instead.
4. **Auth secret.** Random, at least 32 characters, different from every local value:
   ```bash
   openssl rand -base64 32 | pnpm --filter @cgis/api exec wrangler secret put BETTER_AUTH_SECRET --env production
   ```
   Run it before the first deploy: `env.production` lists the secret in `secrets.required`, and wrangler refuses to deploy a Worker that lacks it. When the Worker does not exist yet, wrangler offers to create it as an empty draft to hold the secret; accept. Changing the secret later signs everyone out.
5. **First deploy** from the owner's machine. It also applies the Durable Object migrations `v1` (`Room`) and `v2` (`RateLimiter`).
   ```bash
   pnpm install --frozen-lockfile
   pnpm --filter @cgis/api types        # apps/web's tsc -b reads the generated Worker types
   pnpm --filter @cgis/web build
   pnpm --filter @cgis/api run deploy --env production
   ```
6. **GitHub secrets** (Settings → Secrets and variables → Actions, or `gh secret set <NAME>`):
   - `CLOUDFLARE_API_TOKEN`: an account API token from the "Edit Cloudflare Workers" template, scoped to this account only.
   - `CLOUDFLARE_ACCOUNT_ID`: the account id.
   - `DATABASE_URL`: the Neon direct (non-pooled) URL, for migrations only. The Worker never reads it.
7. **Smoke checks** below, then a browser: register, draw on `/map`, and a second browser profile sees the polygon live.

## CI deploy

`.github/workflows/deploy.yml` runs on every push to `main` and on demand (Actions → deploy → Run workflow). Its `secrets` job checks that the three GitHub secrets exist (a job-level `if` cannot read secrets); without them the `deploy` job is skipped, not failed. `deploy` then refuses a placeholder origin, installs, migrates Neon, generates the Worker types, builds the web and runs `wrangler deploy --minify --env production`. Deploys run one at a time and are never cancelled halfway.

Migrations run before the new Worker goes live, so the running Worker meets the new schema for a moment: keep migrations backward compatible (add, backfill, then remove in a later deploy). Every pull request runs `wrangler deploy --dry-run --env production` in `ci.yml`, which proves the production config resolves and bundles with the web build.

## Smoke checks

```bash
ORIGIN=https://collaborative-gis.<subdomain>.workers.dev
curl -s "$ORIGIN/healthz"                                       # 200 {"ok":true}
curl -s "$ORIGIN/readyz"                                        # 200 {"ok":true,"db":"up"}; 503 NOT_READY when Neon is unreachable
curl -s -o /dev/null -w '%{http_code}\n' "$ORIGIN/openapi.json" # 200
curl -s -o /dev/null -w '%{http_code}\n' "$ORIGIN/docs"         # 200 once the API reference UI is merged; until then the Worker's 404
curl -s -i "$ORIGIN/ws" -H 'Upgrade: websocket' -H 'Connection: Upgrade' \
  -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' | head -1   # 401: no session
curl -s -o /dev/null -w '%{http_code} %{content_type}\n' "$ORIGIN/map"  # 200 text/html: the SPA
```

Logs: Workers Logs in the dashboard (`observability.enabled`), or live with `pnpm --filter @cgis/api exec wrangler tail --env production`.

## Rollback

```bash
pnpm --filter @cgis/api exec wrangler deployments list --env production
pnpm --filter @cgis/api exec wrangler rollback <version-id> --env production -m "<reason>"
```

Without a version id it returns to the previous version. A rollback replaces the Worker version only: it never touches Neon (migrations are forward-only; undo a schema change with a new migration), and it cannot reach a version deployed before a Durable Object migration (a new `migrations` tag).

## Local run of the production config

The production routing (SPA and API on one origin) on your machine, against the compose PostGIS:

```bash
pnpm --filter @cgis/api types && pnpm --filter @cgis/web build
cd apps/api
CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE=postgresql://cgis:cgis@localhost:5433/cgis \
  pnpm exec wrangler dev --env production \
  --var CLIENT_ORIGIN:http://localhost:8787 --var BETTER_AUTH_URL:http://localhost:8787
```

`BETTER_AUTH_SECRET` comes from `apps/api/.dev.vars` (or the shell). `env.production` has no `localConnectionString`, hence the variable. Open http://localhost:8787: the same app, served by the Worker instead of Vite.
