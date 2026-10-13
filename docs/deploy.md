# Deploy

One Worker, `collaborative-gis-api-production` (wrangler's default name for the `production` env), serves the built SPA (`apps/web/dist`) as static assets and the API, the WebSocket and both Durable Objects (`Room`, `RateLimiter`) on one origin. Postgres is the Neon project `winter-credit-61110991`, reached through the Hyperdrive config `cgis-neon` (`ffdceaec4c3b4c70a324ebf9da6cb7a9`). Its configuration is `env.production` in `apps/api/wrangler.jsonc`; nothing in the repository is a secret, and the production origin is not in the repository either: every deploy passes it with `--var`, from the repository variable `PRODUCTION_ORIGIN`. Checked with wrangler 4.149.0.

Commands run from the repository root. `wrangler` below is the pinned dev dependency: `pnpm --filter @cgis/api exec wrangler …`, signed in with `wrangler login` or with `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in the shell. Deploying needs the Workers Paid plan: Better Auth's scrypt hashing exceeds the Free plan's CPU limit (D21).

## Routing

- `/api/*`, `/ws`, `/healthz`, `/readyz`, `/docs` and `/openapi.json` always reach the Worker (`assets.run_worker_first`), so an unknown API path is the Worker's JSON 404, never the SPA.
- Any other path is a built file when one matches, else `index.html` (`not_found_handling: "single-page-application"`), so `/map` and `/login` load the SPA.

## Top level and `env.production`

The top level of `wrangler.jsonc` is the local setup (`wrangler dev`, the workerd tests, `hono batch`). `env.production` inherits `main`, the compatibility date and flags, `observability`, the Durable Object `migrations` and any `triggers`; bindings, vars and secrets are never inherited, so it repeats them. `pnpm typecheck` fails when one side gains a binding the other lacks (`apps/api/test/deploy-config.test.ts`). `env.production` declares `CLIENT_ORIGIN` and `BETTER_AUTH_URL` as empty strings, so the generated binding types keep them required; `--var` replaces both at deploy time.

| | Top level (local) | `env.production` |
|---|---|---|
| Worker | `collaborative-gis-api`, never deployed | `collaborative-gis-api-production` |
| Static assets | none: Vite serves the SPA on :5173 and proxies `/api`, `/ws` | `../web/dist` (build it first) |
| `CLIENT_ORIGIN` | var, `http://localhost:5173` | `--var` at deploy, `PRODUCTION_ORIGIN` |
| `BETTER_AUTH_URL` | `.dev.vars` | `--var` at deploy, `PRODUCTION_ORIGIN` |
| `BETTER_AUTH_SECRET` | `.dev.vars` | Worker secret |
| `HYPERDRIVE` | `localConnectionString`, the compose PostGIS | `cgis-neon` |

Never run `wrangler deploy` without `--env production`: the top level would create a second Worker, `collaborative-gis-api`, with localhost origins. Never run it without the two `--var`s either: the Worker would run with empty origins, so CORS and the WebSocket origin gate refuse every browser and every auth request fails. Such a Worker answers `/readyz` with 503 `NOT_READY` and `config: down`, and its log line names the var that is not an absolute URL.

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
3. **Auth secret.** Random, at least 32 characters, different from every local value:
   ```bash
   openssl rand -base64 32 | pnpm --filter @cgis/api exec wrangler secret put BETTER_AUTH_SECRET --env production
   ```
   Run it before the first deploy: `env.production` lists the secret in `secrets.required`, and wrangler refuses to deploy a Worker that lacks it. When the Worker does not exist yet, wrangler offers to create it as an empty draft to hold the secret; accept. Changing the secret later signs everyone out.
4. **Production origin.** The repository never holds it. Pick the hostname:
   - **Custom domain** (needed for the WAF rule and the Health Check below; the zone must be on this Cloudflare account): attach it once in the dashboard, Workers & Pages → `collaborative-gis-api-production` → Settings → Domains & Routes → Add → Custom domain → `<your-hostname>`. Cloudflare creates the DNS record and the certificate. The config has no `routes` entry, so a deploy never adds or removes it.
   - **workers.dev**: `collaborative-gis-api-production.<subdomain>.workers.dev`, the subdomain from Workers & Pages.

   Then store the origin (https, no trailing slash) as a repository variable; the deploy workflow passes it to the Worker as both `CLIENT_ORIGIN` and `BETTER_AUTH_URL`:
   ```bash
   gh variable set PRODUCTION_ORIGIN --body 'https://<your-hostname>'
   ```
   The CORS policy, Better Auth's trusted origins and the WebSocket origin gate compare against `CLIENT_ORIGIN`; an https `BETTER_AUTH_URL` turns on `Secure` `__Secure-` cookies.
5. **First deploy** from the owner's machine. It also applies the Durable Object migrations `v1` (`Room`) and `v2` (`RateLimiter`).
   ```bash
   ORIGIN=https://<your-hostname>
   pnpm install --frozen-lockfile
   pnpm --filter @cgis/api types        # apps/web's tsc -b reads the generated Worker types
   pnpm --filter @cgis/web build
   pnpm --filter @cgis/api run deploy --env production \
     --var "CLIENT_ORIGIN:$ORIGIN" --var "BETTER_AUTH_URL:$ORIGIN"
   ```
6. **GitHub secrets** (Settings → Secrets and variables → Actions, or `gh secret set <NAME>`):
   - `CLOUDFLARE_API_TOKEN`: an account API token from the "Edit Cloudflare Workers" template, scoped to this account only.
   - `CLOUDFLARE_ACCOUNT_ID`: the account id.
   - `DATABASE_URL`: the Neon direct (non-pooled) URL, for migrations only. The Worker never reads it.
7. **Smoke checks** below, then a browser: register, draw on `/map`, and a second browser profile sees the polygon live.
8. **Turn on CI deploys**, last, once everything above is in place:
   ```bash
   gh variable set DEPLOY_ENABLED --body true
   ```

## CI deploy

`.github/workflows/deploy.yml` runs when the `ci` workflow has passed on a push to `main` (a `workflow_run` trigger; it deploys the commit `ci` checked, and a failed or cancelled `ci` run deploys nothing), and on demand (Actions → deploy → Run workflow). Its job runs only when the repository variable `DEPLOY_ENABLED` is `true` (a job-level `if` can read variables, not secrets), so a fork or an unconfigured repository skips it; once it is on, a missing secret fails the step that needs it. The job runs in the GitHub environment `production`, created on its first run, so the three secrets can later move from the repository to that environment (Settings → Environments → production). It refuses an empty `PRODUCTION_ORIGIN`, installs, migrates Neon, generates the Worker types, builds the web and runs `wrangler deploy --minify --env production --var CLIENT_ORIGIN:… --var BETTER_AUTH_URL:…` with that origin. Deploys run one at a time and are never cancelled halfway.

Migrations run before the new Worker goes live, so the running Worker meets the new schema for a moment: keep migrations backward compatible (add, backfill, then remove in a later deploy). Every pull request runs `wrangler deploy --dry-run --env production` in `ci.yml`, which proves the production config resolves and bundles with the web build.

## Smoke checks

```bash
ORIGIN=https://<your-hostname>
curl -s "$ORIGIN/healthz"                                       # 200 {"ok":true}
curl -s "$ORIGIN/readyz"                                        # 200 {"status":"ready","db":"up","room":"up","config":"up"}; 503 NOT_READY names what is down
curl -s -o /dev/null -w '%{http_code}\n' "$ORIGIN/openapi.json" # 200
curl -s -o /dev/null -w '%{http_code}\n' "$ORIGIN/docs"         # 200 text/html: the API reference page (Scalar)
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

## Production hardening

### In the Worker (nothing to set up)

`apps/api/src/auth.ts`, covered by `apps/api/test/auth/hardening.test.ts`. An https `BETTER_AUTH_URL` is what marks a deployed Worker: Better Auth's own production switch reads `NODE_ENV`, which a Worker does not set.

- **Origins.** Better Auth trusts `CLIENT_ORIGIN` and its own `BETTER_AUTH_URL`, nothing else: a sign-in or sign-out sent with any other `Origin` is 403 and sets no cookie.
- **Cookies** (https only). Every auth cookie is `__Secure-`-prefixed, `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/` and host-only (no `Domain`).
- **Sign-in rate limit** (https only). Better Auth's built-in limiter, `AUTH.RATE_LIMIT_MAX` (10) attempts per client IP per `AUTH.RATE_LIMIT_WINDOW_S` (60 s) on `/api/auth/sign-in/*`, then 429 with `X-Retry-After`. Sign-up keeps Better Auth's default of 3 per 10 s and every other auth path 100 per 10 s. The client IP is `cf-connecting-ip`. Counts live in memory, so no table is needed, but each Worker isolate counts on its own: it slows one client down without being a global limit. The WAF rule below is the global limit.

### WAF rate limiting rule on `/api/auth/*`

WAF rules run on traffic to a zone (a domain on the Cloudflare account), and `*.workers.dev` is not one. The rule needs the Worker on a custom domain (owner checklist step 4, attached in the dashboard). On workers.dev, only the in-Worker limit applies.

The Free plan allows one rate limiting rule, counted per IP over 10 s, a 10 s block, and an expression on the URI path only. This rule fits within that. The SPA makes a few auth requests per page view (a session check on load and on focus, sign-in and then a session check), so 20 per 10 s per IP leaves room for that and for a few users behind one NAT. A scripted password guesser is held to 2 requests a second per data center, whichever isolate it reaches.

Dashboard: the zone → Security → WAF → Rate limiting rules → Create rule.

| Field | Value |
|---|---|
| Rule name | `auth rate limit` |
| Expression (Edit expression) | `(starts_with(http.request.uri.path, "/api/auth/"))` |
| With the same characteristics | IP (Cloudflare also counts per data center, `cf.colo.id`) |
| When rate exceeds | 20 requests per 10 seconds |
| Then take action | Block, for 10 seconds (Cloudflare answers 429) |

Wrangler has no WAF command. Over the API (a token with Zone WAF Edit on the zone), `characteristics` must list `cf.colo.id` with `ip.src`, and a `PUT` to the zone's `http_ratelimit` phase entrypoint replaces every rate limiting rule in it: on a zone with other rate limiting rules, use the dashboard.

### Health check on `/readyz`

`/readyz` answers 200 only when the database and the Room answered within their deadlines and `CLIENT_ORIGIN` and `BETTER_AUTH_URL` are absolute URLs, and 503 `NOT_READY` otherwise, with `details` naming what is down. The 200 body is `{"status":"ready","db":"up","room":"up","config":"up"}`. Cloudflare Health Checks need a zone on the Pro plan or higher (the Free plan has none) and the custom domain above. On workers.dev, point any external uptime monitor at the same URL, expecting the same code and body.

Dashboard: the zone → Traffic → Health Checks → Create (newer dashboards list it under Smart Shield).

| Field | Value |
|---|---|
| Name | `readyz` |
| Address | the custom domain's hostname |
| Type, port | HTTPS, 443 |
| Path, method | `/readyz`, GET |
| Expected codes | `200` |
| Response body | `"db":"up","room":"up","config":"up"`: a case-insensitive substring of the first 10 KB |
| Interval, retries, timeout | 60 s, 2, 5 s |
| Consecutive fails | 2 |
| Follow redirects | off |
| Request header | `Host`: the custom domain's hostname |

Then Notifications → Add → Health Checks status notification for this check. Each probe runs one query on Neon. An interval shorter than Neon's autosuspend delay (5 minutes by default) keeps its compute running around the clock, so on Neon's free plan use a longer interval. Over the API, the same check needs a token with Health Checks Edit.

### Logs

Workers Logs (`observability.enabled`) keeps 7 days on Workers Paid (3 on Free) and includes 20 million log events a month, then $0.60 per million. If traffic grows past that, set `observability.head_sampling_rate` (0 to 1, default 1) in `wrangler.jsonc`. Anything that must be kept longer, such as incident evidence or audit questions, has to leave Cloudflare before then, either through Logpush or by querying `audit_log` in Neon, which keeps its own retention. Secrets never reach the logs (`LOG.REDACT_KEYS`). Live: `wrangler tail --env production`.

### Checklist

Run these against the deployed origin (`ORIGIN=https://…`, no trailing slash).

- [ ] **Secrets and variables set.** `wrangler secret list --env production` lists `BETTER_AUTH_SECRET`; `gh secret list` lists `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` and `DATABASE_URL`; `gh variable list` lists `PRODUCTION_ORIGIN` and `DEPLOY_ENABLED` (`true`).
- [ ] **Origin set.** `gh variable get PRODUCTION_ORIGIN` prints the https origin with no trailing slash, and the Worker's Settings → Variables and Secrets show `CLIENT_ORIGIN` and `BETTER_AUTH_URL` with that same value.
- [ ] **Hyperdrive caching off.** `wrangler hyperdrive get ffdceaec4c3b4c70a324ebf9da6cb7a9` shows `"disabled": true` under `caching`.
- [ ] **Cookies and origins.** A sign-in with `-H "Origin: $ORIGIN"` sets `__Secure-better-auth.session_token` with `Secure; HttpOnly; SameSite=Lax` and no `Domain`. The same request with `-H 'Origin: https://evil.example'` answers 403.
  ```bash
  curl -si "$ORIGIN/api/auth/sign-in/email" -H "Origin: $ORIGIN" -H 'content-type: application/json' \
    -d '{"email":"<registered email>","password":"<password>"}' | grep -i '^set-cookie'
  ```
- [ ] **Health check green.** `curl -s "$ORIGIN/readyz"` is 200 with `db`, `room` and `config` `up`, and the Cloudflare Health Check (or the external monitor) reports healthy.
- [ ] **WAF rule on** (custom domain). Burst past the threshold and expect some 429s from Cloudflare:
  ```bash
  for i in $(seq 25); do curl -s -o /dev/null -w '%{http_code}\n' "$ORIGIN/api/auth/get-session"; done | sort | uniq -c
  ```
- [ ] **Rollback ready.** `wrangler deployments list --env production` lists the live version, and the owner can run `wrangler rollback` (above).
