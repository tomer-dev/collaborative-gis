# Process log

Chronological record of how this roadmap was produced, for the reviewer. Facts only.

## 2026-10-12 — Session 1: roadmap
1. Read the product brief PDF (4 pages): core requirements, additional challenges, stack constraints, evaluation criteria, submission guidelines.
2. Checked repo state: empty git repository, no commits.
3. Loaded skills: superpowers:brainstorming (process), context7-mcp (documentation lookup). Classified the work as architectural (greenfield).
4. Technology research via Context7 and official sites: PostGIS, Leaflet, Proj4Leaflet, EPSG:2039, TanStack Router, TanStack Query, Better Auth, Drizzle ORM, Neon, Fastify (+websocket, rate-limit, swagger), Vercel (Vite, Fastify, Functions limits, WebSockets beta, Services, Container runtime). Findings in `docs/research-notes.md`.
5. Checked govmap sources: open-data WMS capabilities downloaded (233 KB) — supports EPSG:2039 and EPSG:3857 but exposes vector layers only; aerial imagery is served from an ITM tile cache (community sources). Logged as a spike.
6. Blocked actions: 1Password lookup of the Neon item (service account needs `--vault`; permission classifier denied) and one Context7 PostGIS query (classifier denied). Worked around PostGIS by reading postgis.net directly. Neon credentials pending from the user.
7. Decisions confirmed with the user: Node/TypeScript Fastify + ws; Better Auth; scope = core + all additional backend challenges, advanced optimisation as design docs.
8. User feedback incorporated: deeper doc reading per technology; tickets reference the Claude skill to use (react-expert, better-auth-best-practices, websocket-engineer, postgres-pro, …); added E7 Vercel deployment phase; Linear team is TOM.
9. Wrote `docs/roadmap.md` (8 epics, 61 tickets, dependency graph, milestones M0–M4).
10. User redirected deployment from Vercel to Cloudflare because of the Vercel WebSocket duration cap. Researched Cloudflare Workers, Durable Objects (WebSocket Hibernation API, alarms, limits), Hyperdrive, static assets + Vite plugin, rate-limit binding, Cache API, Cron Triggers, Hono (Workers + Node), hono-openapi, Better Auth on Hono/Workers.
11. Consequences applied to the roadmap: backend framework Fastify → Hono (runs on Workers and on Node for docker-compose parity); realtime moves into a `Room` Durable Object; rate limiting becomes an exact per-user Durable Object counter; caching uses the Workers Cache API; retention purge uses a Cron Trigger; E7 rewritten for Cloudflare. Vercel findings kept in the research notes for the ADR.
12. 1Password verified: Neon API credential readable from vault `Dev` (item `tomercouch-neon`); referenced from ticket 0.3.
13. Linear (personal workspace, team TOM) via the `linear-personal` MCP server: project P-TOM-1 "Collaborative GIS", 5 milestones (M0–M4), 10 labels (`lane:*`, `spike`, `design-doc`), 8 epics (TOM-5…TOM-12), 61 sub-issues (TOM-13…TOM-73) each with skill, scope, acceptance, milestone, priority and `blocked by` relations wired by identifier.
14. Committed `docs/` and `.gitignore` as the first commit.
15. User asked for the critical path and to continue the superpowers process. Ran `find-skills`: installed `postgis/postgis@postgis`, `timescale/pg-aiguide@design-postgis-tables`, `cloudflare/skills@durable-objects`, `cloudflare/skills@workers-best-practices`, `cloudflare/skills@wrangler` (all official sources). No credible Leaflet or Hono skill found.
16. Added the critical-path section to `docs/roadmap.md` (longest chain vs highest-uncertainty item, day-1 parallel starts, risk register) and patched Linear epics E1/E4/E7 with the new skill references.
17. Wrote the design spec `docs/superpowers/specs/2026-10-12-collaborative-gis-design.md` (architectural path: spec → user review → writing-plans).
18. User asked for extensive reading of leafletjs.com and hono.dev (agents page, CLI, honojs/skills). Read the Leaflet 2.0 reference in four passes, download page, 2.0 alpha post, and seven tutorials; Hono agents, CLI, Cloudflare Workers, Node.js, WebSocket helper, best practices. Installed official `honojs/skills@hono`. Checked Proj4Leaflet on GitHub: last release 2017, open "Leaflet V2.0" issue.
19. Decisions recorded: Leaflet 1.9.4 (2.0 is alpha), hand-rolled EPSG:2039 CRS on proj4 instead of Proj4Leaflet, Hono CLI in scaffold + CI contract tests, `@hono/node-ws` replaced by `@hono/node-server` ws support. Updated research notes, roadmap, spec and Linear tickets 0.1, 5.3, 5.4, 5.7, 6.2, 6.4.
20. Built `docs/decisions-brief.html` (local, offline) with a plan overview, critical chain, risk matrix and ten decisions. User returned decisions: D1 spec approved; D2 Leaflet 1.9.4; D5 exact DO limiter; D7 one room per map; D8 retention 7 days; D10 E2E included. D3 narrowed by the user to "no fallback imagery; govmap is the requirement". D4, D6, D9 returned with questions; answered in chat (409 vs last-writer-wins, version-stamped cache keys, Node path is not a faithful Workers environment → workerd-in-compose variant offered).
21. User resolved D3 = option A, D4 = 409 + two-button prompt, D6 = version-stamped cache keys, D9 = compose with workerd container. Applied to spec, roadmap and Linear (TOM-45, 50, 59, 65). All ten decisions closed; moving to writing-plans for M0 + M1.
22. Wrote `docs/superpowers/plans/2026-10-12-m0-foundation.md` (7 tasks, TDD steps). User asked whether the brief constituted a careful human spec review; answer: no. Added a §2–§9 spec walkthrough with per-section review checkboxes and four surfaced assumptions (D11 single map, D12 edit rights, D13 default numbers, D14 out-of-scope) to the brief; D1 reopened. Implementation does not start until D1 is re-approved.
23. User reviewed spec §2–§9 individually, resolved D11 (single map), D12 (anyone edits), D13 (defaults), D14 (out-of-scope list) and re-approved D1. Spec status set to approved; decisions D1–D14 recorded in §10. Next: choose execution method for the M0 plan.
24. Task 1 (TOM-13 part 1): pnpm 12.5.1 workspace root, shared tsconfig/eslint 10/prettier; commits 1c4631a, 3755a95, da03359; reviewed (fable), one fix round.
25. Task 2 (TOM-14): `@cgis/shared` Zod 4 contracts (polygon, area, bounds, api error, ws events); commits c22e6b7, b3f0060, cd4e3cc; reviewed, one fix round (unique-vertex test).
26. Task 3 (TOM-13 part 2): `apps/api` Hono Worker, `/healthz`, fail-closed `/readyz`, tests in workerd via `@cloudflare/vitest-plugin` (replaces the deprecated vitest-pool-workers), `@hono/cli` 1.0.0-rc.6; commits d005026, 236806a; reviewed, one fix round (fixed readyz/404 bodies, no error echo).
27. Task 4 (TOM-13 part 3): `apps/web` Vite React 19 placeholder linked to `@cgis/shared`; commit 4d3f20d; reviewed, approved first pass.
28. Task 5 (TOM-15): docker-compose PostGIS on host port 5433, Neon project `winter-credit-61110991` (aws-eu-central-1) with PostGIS, Hyperdrive config `cgis-neon`, readyz 200 against the local DB; commit b7d609c, follow-up 02a3ede (compose port bound to loopback only, `127.0.0.1:5433`). From Task 5 on, reviews are per epic (one fable review at the end of M0), per user ruling.
29. Task 6 (TOM-16): `.github/workflows/ci.yml`, job `ci` on pull requests and pushes to `main`: install (frozen lockfile), lint, format check, typecheck, tests for all packages, `wrangler deploy --dry-run` (no Cloudflare credentials needed, verified locally with none present). PostGIS service mapped to runner port 5433 so the api tests use `localConnectionString` unchanged. Actions at current majors: `actions/checkout@v7`, `pnpm/action-setup@v6` (v6.1.0 added pnpm 12 support), `actions/setup-node@v7` with pnpm cache. Node pinned to 22.23.3 in `.node-version` (latest 22.x); root `engines.node` raised to `>=22.22.2` (jsdom 30). Commit d4ac6bb. Local PostGIS image switched from `postgis/postgis:16-3.4` (amd64-only on Docker Hub) to `imresamu/postgis:18-3.6` (amd64 + arm64, PG 18 / PostGIS 3.6 like Neon) in compose and CI; PG 18 images set `PGDATA=/var/lib/postgresql/18/docker`, so the compose volume now mounts `/var/lib/postgresql`; local volume recreated, `pnpm db:check` reports PostGIS 3.6 (lib 3.6.1, PostgreSQL 18.1), api tests 4/4. Commit f5d8eaa. Pushed `main` (docs-only ancestor, now the GitHub default branch) and `worktree-m0-foundation` to `tomer-dev/collaborative-gis`; draft PR #1 into `main`; CI run 38273835856 on f5d8eaa green on first attempt (Node 22.23.3, pnpm 12.5.1, service healthy, tests 13 + 1 + 4 passed, dry run 258.81 KiB).
30. Task 7 (TOM-17), M0 executed: workspace root, shared contracts (13 tests), Hono Worker with `/healthz` and `/readyz` (4 tests, workerd), Vite placeholder (1 test), local + Neon PostGIS with Hyperdrive binding (Neon project `winter-credit-61110991`), CI green on draft PR #1 (runs 38273835856 on f5d8eaa and 38274096578 on 78c57cb), README + ADR template + ADR 0001–0003. README setup lists only commands run in this task (`pnpm install`, `pnpm db:up`, `pnpm db:check`, `pnpm test`, `pnpm --filter @cgis/api dev`, `pnpm --filter @cgis/web dev`, typecheck, lint, format check, `pnpm db:down`, `hono request --runtime workerd`); no govmap terms-of-use line, per user ruling. Roadmap and M0 plan updated to name `imresamu/postgis:18-3.6` and `@cloudflare/vitest-plugin`; the plan's `defineWorkersConfig` snippet marked superseded. Reviews were per epic from Task 5 onward (user ruling): one review for the whole of M0.
31. M0 close-out and follow-up. Commit 8c18aba amended to 5a1f338 to add the co-author trailer, force-pushed with lease; CI run 38275136103 ran on the pre-amend head 8c18aba (green). b5abeba makes `pnpm db:up` wait for PostGIS health (`docker compose up -d --wait`). M0 merged into `main` via PR #1 (merge commit 0129683, which also carries 9bfcd8c, the M1 vertical-slice plan). Epic review of M0 (fable): verdict "with fixes". Branch `m0-followup` (from b5abeba), PR #2, carries those fixes plus the three review comments on PR #1: errors consolidated in `apps/api/src/errors.ts` (per user clarification: one code-to-status table with per-code helpers such as `badRequestError`, not a raw `apiError(c, status, code, message)`), an own favicon, and Tailwind 4.3.3 with an `@theme` light/dark palette. Review fixes: `/readyz` time limit (pg connect/query timeouts plus a 3 s hard deadline, because workerd's `socket.close()` waits on a pending TCP connect), `HTTPException` keeps its status in `onError`, 500 log carries the stack, pg `error` listener narrowed, `AreaVersion` schema, empty `zoom` treated as absent, `Env = CloudflareBindings`, CI hardening (read-only token, concurrency, web build, PostGIS start period), port comments in `.env.example` and `scripts/db-check.sh`, stale tool names in roadmap/spec/M0 plan. Tests: shared 16, api 20, web 1.

## 2026-10-12/13 — M1: vertical slice

Plan: `docs/superpowers/plans/2026-10-12-m1-vertical-slice.md`. Parallel lanes in separate worktrees, each task a PR (stacked PRs while their parents were open); one review per PR and one for the whole milestone. Ticket ids are Linear issues.

Tasks, one line each:

- T0 (TOM-75), PR #4: scaffold for parallel lanes: one shared constants module plus `docs/constants.md` (ruling: no hardcoded values), the error table, a stub per lane.
- T1 (TOM-18, TOM-19), PR #9: Drizzle schema (areas, area versions, audit log) and migrations 0000–0001; a custom polygon column, because Drizzle's `geometry()` is points-only; a Node `db` test project.
- T2 (TOM-20, TOM-21), PR #15: spatial helpers (insert, update-if-version, bounds, soft delete, audit), each write one statement with `ST_IsValid` and the geodesic area.
- T3 (TOM-27, TOM-31), PR #7: request id, CORS, secure headers, timeout, structured `log()`.
- T4 (TOM-25), PR #13: Better Auth on Workers through the Drizzle adapter on a per-request `pg` client (migration 0002). D21: Better Auth's scrypt stays; deploying needs Workers Paid (a spike measured hashing against the Free plan's 10 ms CPU cap).
- T5 (TOM-26), PR #18: `attachUser`, `requireUser` and the WebSocket session gate; the Origin check was added in review.
- RateLimiter (TOM-29, pulled forward from M2), PR #10: exact per-user sliding window in a Durable Object, 429 middleware.
- T6 (TOM-33), PR #8: Room Durable Object on the hibernation API; the stub auth was removed from production code in review (tests inject the user).
- T7 (TOM-34, TOM-35, TOM-36), PR #16: WebSocket protocol handlers, hibernation-safe presence, draft relay with a per-socket token bucket.
- T8 (TOM-37), PR #21 (into #20): fan-out of committed area changes to the Room, map version counter.
- T9 (TOM-42), PR #6: TanStack Router/Query shell with the protected `/map`. D19 (HTTP clients) was decided here and amended: Better Auth's React client for auth, Hono `hc` for the areas API.
- T9b (TOM-77), PR #14: design system "Grid 4" (D15–D18): tokens, UI components, Storybook.
- T10 (TOM-44), PR #12: Leaflet OSM map with the areas and drafts panes and a debounced bbox.
- T11a (TOM-48, TOM-49), PR #11: geodesic area and self-intersection. Ruling: prefer maintained libraries, so `@turf/area` and `@turf/kinks` 7.4.0 replaced the hand-written maths. The draw tool went through three rulings: Geoman adapter; reversed under the product brief's "no third-party plugins for the collaborative features"; D25 final: the clause is read narrowly (collaboration SDKs are out, map drawing is not collaborative), so the tool is an adapter over `leaflet-editable` 1.3.2 and the realtime protocol stays ours.
- T11b (TOM-49), PR #17: draw control with the live area readout.
- T12 (TOM-43), PR #19: login, register and sign-out on Better Auth's React client.
- T15 (TOM-28, TOM-54, TOM-55, TOM-56), PR #20: areas routes with 422 validation, 409 optimistic concurrency, the audit row in the same transaction (D20, migration 0003), OpenAPI and a `hono batch` contract file. D23: every query through the Drizzle builder.
- T13 (TOM-50), PR #24: areas data layer on `hc`, polygons on the map, save, area and conflict dialogs.
- T14 (TOM-51), PR #22: WebSocket hook: connection state machine, presence, ghost drafts, cache patching.
- T16 (TOM-78), PR #36: `m1/integration` = `main` + #20 + #22 + #24; the carried fixes and audit cuts below, the milestone review fixes, this log and the README.
- Docs: PR #5 (ADR-0004, horizontal scaling), PR #23 (M2 plan, decisions D19–D25), PR #25 (public naming).

Rulings that changed scope:

- Audit cuts (whole-repo over-engineering audit, owner-approved): icons to `lucide-react`, a native tooltip, MapControl trimmed, the legacy-names test deleted, the server-assigned presence colour only, the area formatter folded into `Stat`, the form on `FormData`, `class-variance-authority` dropped (T9b, T11b, T12); in T16: one `log()` at every log site, Hono's `requestId`, one `apiError`, delegating wrappers inlined, unused constants deleted, one `AuthUser` and one `Bbox` type, `toWellFormed()` for the name cap, one Vite config, one test sign-up helper.
- D19 HTTP clients; D20 `audit_log` stays (versions are state, audit rows outlive them); D21 scrypt on Workers Paid; D22 Proj4Leaflet for EPSG:2039; D23 Drizzle builder only; D24 Better Auth cookie cache, 5 minutes; D25 narrow reading of the no-plugins clause.
- Constants: one file per domain under `packages/shared/src/constants/`, and `docs/constants.md` generated from their doc comments (`pnpm constants:docs`, checked in CI), to stop parallel lanes conflicting on one file.

T16 checks in a browser (headless Chrome driven by Playwright, two isolated browser contexts as two users, against `wrangler dev` and the Vite dev server on ports 8799 and 5199 because 5173 was taken):

- Both users signed up and reached `/map`; each presence list showed both, the user marked "(you)".
- The header avatar carried the user's own presence colour (`#e87ba4` for A).
- Loading `/map` made one `GET /api/areas`.
- A drew three vertices; B saw the ghost polygon with stroke `#e87ba4`, A's colour as B's presence list showed it.
- With A's UI in the dark theme, an open draw handle was still filled white (`oklch(1 0 0)`).
- A finished and saved "Orchard"; B saw one saved polygon and no ghost.
- B opened the area; B's socket was made to drop `area:updated` (Playwright WebSocket routing), A renamed the area, and B's rename from the stale version opened the conflict dialog showing A's name; "Load theirs" showed A's version.
- A signed out and landed on `/login`; B's presence list then showed B alone.
- No page errors in either context.
- On the production build (`vite build`, `vite preview`): one Leaflet in the bundle; `L.Editable` attaches to it and is the map's default `editToolsClass`; drawing works. Reading `L.Editable` from the ESM namespace instead fails with or without `resolve.dedupe: ['leaflet']`: the bundler's CommonJS interop copies Leaflet's exports into the namespace before the plugin adds `Editable`. The `editToolsClass` lookup stays, with that reason in its comment.
- Not reproduced: a tab hidden for more than five minutes in desktop Chrome (timer throttling against the Room's idle sweep); the client now pings when the tab is shown again, and the server-side cutoff is an M2 lane's.

## 2026-10-12/13 — M2: hardening, with the M3 test lanes and the M4 repository side

Plan: `docs/superpowers/plans/2026-10-12-m2-hardening.md`. Same model as M1: parallel lanes in separate worktrees, one PR per task (stacked where a lane needed another's code), one integration lane (H15) and one review for the whole milestone. Every lane branched from the M1 integration (`m1/integration-t16`).

Tasks, one line each:

- H1 + H16 (TOM-22, TOM-20, ticket 1.7), PR #32: batched idempotent seed (`db:seed`) and the bounds EXPLAIN benchmark (`db:explain`: on 10,000 areas, GiST p95 0.22 ms against 1.33 ms without index scans); reads on the Drizzle builder, with an ESLint rule rejecting hand-written `SELECT` in `sql` templates; M1 review fixes M6 (404/409 before 422) and M7 (write-CTE rows Zod-parsed).
- H2 (TOM-23), PR #26: retention purge of areas soft-deleted more than 7 days ago, daily Cron Trigger, one audit row per run (migration 0004, `audit_log.details`).
- H3 (TOM-58), PR #28: `GET /api/areas/:id/versions` and `POST /api/areas/:id/revert/:version` (a revert is a new version).
- H4 (TOM-60), PR #33: audit rows for sign-in, failed sign-in, sign-up, sign-out, 422/429 rejections and Room draw sessions (migration 0005, `audit_log.request_id`).
- H5 (TOM-29 REST half, TOM-30), PR #30: `mutationGuards()` (session, D5 budget, 64 KiB body cap: M1 review M2), AbortSignal-aware database clients under the request timeout, PUT `version` capped at the Postgres integer max.
- H6 + H7 (TOM-40, TOM-38, TOM-61 half, TOM-32), PR #35: every `draft:update` frame spends the user's D5 budget (one action per draft session since PR #46, below), sockets idle past 90 s are reaped (M1 review I1 server half and M8), `bumpVersion()`/`getVersion()` RPC, `/readyz` pings the Room.
- H8 (TOM-45, TOM-46), PR #29: EPSG:2039 with Proj4Leaflet (D22), the govmap aerial tile layer, ADR-0005; closes the govmap spike.
- H9 (TOM-61), PR #39: viewport reads through the Workers Cache API, keyed by quantised tile, zoom and the Room's `{ epoch, version }` (zoom left the key in the M2 review fix M6); ETag and 304.
- H10 (TOM-62), PR #34: OpenAPI 3.1 validation test and the `/docs` reference UI (Scalar, bundle pinned; since PR #48 a hand-written page that loads the pinned build with Subresource Integrity, `@scalar/hono-api-reference` removed).
- H11 (TOM-39 server half), PR #38: storage epoch, `resync` on error events, re-join after a Room restart, chaos tests.
- H12 (TOM-47), PR #37: base-layer switch OSM ⇄ govmap aerial with the CRS swap and a crossfade; the aerial modules load on first use.
- H13 (TOM-52), PR #42: area panel (areas in view, the selected area's history, revert); the client sends its zoom with each viewport read.
- H14 (TOM-39 client half), PR #41: resync on `resync` errors, reconnect recovery, polling while offline, the connection banner.
- M3 e2e (TOM-64), PR #31: two-browser Playwright scenario and `pnpm e2e`.
- M3 load (roadmap 6.6), PR #27: k6 REST and WebSocket scripts, `pnpm bench`, local results in `docs/benchmarks-load.md`.
- M4 deploy (TOM-69, TOM-70), PR #40: one production Worker (`env.production`) serving the SPA and the API, the deploy workflow, the owner's checklist in `docs/deploy.md`.
- M4 hardening (TOM-73), PR #43: secure cookies and a sign-in rate limit once deployed, the production hardening section of `docs/deploy.md`.
- H15, the integration PR: the lane branches merged in order (merge commits; each conflict resolution is in its merge commit's message), then the wiring the lanes left: the audit middleware and `/docs` mounted in `app.ts`; a mutation bumps the map version before its response and broadcasts after it; one routes helper module; `AUDIT.ACTIONS.RETENTION_PURGE`; one OSM layer factory; the health routes in the OpenAPI document; versions capped at `LIMITS.VERSIONS_PAGE`; per-lane test databases (`<base>_<lane>`, from the git branch); an e2e job in CI; the deploy workflow waits for CI; ADR-0003 marked superseded by ADR-0005.

Rulings and open questions:

- M1 review findings skipped by ruling: M4 (not required) and M9 (speculative). The others went to T16 (I1 web half, I2, M1, M3, M5, M10), H6/H7 (I1 server half, M8), H5 (M2) and H16 (M6, M7).
- D5 and drafts, ruled 2026-10-13 (TOM-85, PR #46): one action per draft session, not per `draft:update` frame. A session runs from the `add` that starts a draft to its save or the 60 s idle sweep; a resync replay inside it spends nothing. The per-socket 10 frames/s limit (`WS.DRAFT_RATE_PER_SEC`, a fixed one-second window since PR #48) is the remaining burst guard and the only per-socket limit on frames.
- Deferred to M5 (E8): docker-compose parity with a workerd container (the M3 compose lane), with telemetry, UX polish, preview branches and Storybook in CI.
- H5: the request's abort signal reaches `withClient` through `AsyncLocalStorage` (`withSignal`), documented in `apps/api/src/db/index.ts`, rather than a parameter on every handler and service.
- H9: the base has no per-request log line, so the cache keeps its own `bounds read` info line (with `cache`, `tile`, `version`).
- H4: tests that call the app without an ExecutionContext still write audit rows in the background; accepted: the rows land in the test databases and no assertion depends on them.
- H12: switching layers maps to the nearest resolution, so a round trip is not always the identity (documented in `mapZoom` and the README).
- M4: assets live in `env.production` only (at the top level they would break `pnpm dev` and `hono batch` before a web build); the production Worker was named `collaborative-gis` (since PR #44 it is wrangler's default for the env, `collaborative-gis-api-production`, and the origin is passed at deploy time); the CI dry run builds the production config.
- M2 epic review (fable): approve with fixes, 4 Important + 8 Minor, fixed in PR #44 in 12 commits, one per finding, each with a test (CI run 38324393793 green). Deviations from the rulings: I2 adds an optional `frameSeq` to RATE_LIMITED errors so the client can take back exactly the refused op; I4's "Overwrite with mine" saves the reverted content as an update; M5 writes one purge audit row per batch, not per run; M7 needed only tests (Hono already keeps the chain's headers on a cache HIT).

## 2026-10-13 — Merges, simplification, production

- PR #44 merged into `main` (705cf13): the M2 hardening lanes with the M3 test lanes and the M4 repository side, through the H15 integration.
- PR #48 merged (8916ac5): the simplification pass, 85 verified rows applied across 143 files, +805 / −2,371 lines (−1,566 net). After review the Room's storage epoch was kept (rows 40 and 42 not applied, 490dca1).
- First production deploy from `main`: the deploy workflow ran once `ci` passed on 0000000 (run 38367128274) and again on 8916ac5 after #48 (run 38369470986). The custom domain is attached in the Cloudflare dashboard, outside the repository; the origin reaches the Worker only through the `PRODUCTION_ORIGIN` repository variable.
- PR #50 (open): readiness guard. `/readyz` gains a `config` check, up only when `CLIENT_ORIGIN` and `BETTER_AUTH_URL` are absolute URLs, so a deploy without the two `--var`s, which refuses every browser, shows as 503 `NOT_READY` with `config: down` instead of passing the readiness check.
- Docs refresh (TOM-66, branch `docs/post-merge-refresh`, stacked on #50): the README run from scratch against the merged code and corrected, a Mermaid architecture diagram, every ADR linked by title, a documentation map; stale lines in `docs/deploy.md` and this log fixed.
- 2026-10-13, later: PR #50 merged (b73d61d, carrying the docs refresh e8bba61); the runners pinned to `ubuntu-24.04` (#52) and the light checks moved to the slim image (#54); the reviewer-scope cleanup (#53); the UX fixes from the audit (#55, 2831a6c). History rewrite: three commit messages that broke the public-repo wording rule were reworded with `git filter-repo` on a fresh clone and `main` was force-pushed; the tree is unchanged, every hash is new. The hashes in this log and in the Linear closing comments were updated from the commit map; GitHub pull-request pages keep their own references to the old commits.
- 2026-10-13, final: a second and last history rewrite cleaned the early documentation's file versions the same way the messages were cleaned (tree unchanged, 454 commits); the hashes above follow the final history. A request to GitHub Support asks for the pre-rewrite objects still reachable through pull-request references to be purged; a fresh repository is the fallback (TOM-89, last).
- M5 (TOM-79): Node pin 22.23.3 → 24.21.0 (PR #59, TOM-90) → 26.11.1 (PR #66, TOM-91, owner ruling 2026-10-13: no wait for the LTS date).
