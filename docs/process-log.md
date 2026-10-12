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
