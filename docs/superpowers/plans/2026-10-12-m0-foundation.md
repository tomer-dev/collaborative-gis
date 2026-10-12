# M0 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the monorepo, the shared Zod contracts, a Hono Worker that answers `/healthz`, a Vite React placeholder, local and Neon PostGIS reachable through a Hyperdrive binding, CI, and the docs skeleton, so that the M1 lanes (db, security, realtime, frontend) can start in parallel.

**Architecture:** pnpm workspace with `apps/api` (Hono on Cloudflare Workers, workerd runtime), `apps/web` (Vite + React), `packages/shared` (Zod schemas consumed by both). The Worker reaches Postgres only through a Hyperdrive binding; locally that binding points at a docker PostGIS via `localConnectionString`. No Node port of the Worker exists (decision D9).

**Tech Stack:** pnpm 9, TypeScript 5, Node 22+, Hono 4 + `@hono/cli`, Wrangler 4, `@cloudflare/vitest-pool-workers`, Vitest 3, Zod 3, Vite 6 + React 19, Docker (`postgis/postgis:16-3.4`), Neon CLI (`neonctl`), 1Password CLI (`op`).

**Spec:** `docs/superpowers/specs/2026-10-12-collaborative-gis-design.md`
**Roadmap / tickets:** `docs/roadmap.md` → Linear TOM-13 (0.1), TOM-14 (0.2), TOM-15 (0.3), TOM-16 (0.4), TOM-17 (0.5)
**Research:** `docs/research-notes.md`

## Global Constraints

- Workers run on workerd; `apps/api` must never import Node-only modules outside `nodejs_compat` scope. `compatibility_flags: ["nodejs_compat"]` is set (spec §2, research "Cloudflare").
- Database access from the Worker goes through `env.HYPERDRIVE.connectionString` only; migrations use the Neon **direct** URL from CI (spec §2, research "Hyperdrive").
- Polygon rules from the spec §3/§5: ≥3 unique vertices, closed ring (first == last), longitude in [-180,180], latitude in [-90,90], ≤1,000 vertices.
- All API errors use `ApiError = { code: string; message: string; details?: unknown }` (spec §6).
- WebSocket envelope `{ type, seq, ts, payload }`; event types `join`, `leave`, `presence`, `draft:update`, `area:created`, `area:updated`, `area:deleted`, `error` (spec §3).
- Secrets never enter the repo. Neon credentials come from 1Password vault `Dev`, item `tomercouch-neon`, read with `op read`; the CLI runs as a service account, so `--vault Dev` is required.
- No `@hono/node-ws`, no Node server for the Worker (decision D9). `@hono/cli` is a dev dependency and `AGENTS.md` tells agents to use it.
- Every commit message ends with the attribution line `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Keep `docs/process-log.md` current: append one numbered line per task when it lands.

## Review Focus

1. **A polygon whose ring is not closed** (first vertex ≠ last) must fail the shared schema with a message naming the rule; the API will later rely on this. Test added in Task 2.
2. **A polygon with 1,001 vertices** must be rejected before any DB work; a 1,000-vertex one passes. Test added in Task 2.
3. **Longitude/latitude swapped** (e.g. `[31.5, 34.8]` meant as Israel) must still be *schema-valid* because both are in range; the schema cannot catch it, so the test documents that it passes and the README setup notes say GeoJSON order is `[lng, lat]`. Test added in Task 2.
4. **`/readyz` when the database is unreachable** must return 503 with the `ApiError` shape, not throw. Test added in Task 3.
5. **`wrangler dev` without the docker database running** must fail at `/readyz` only, not at startup; `/healthz` stays 200. Covered by the same Task 3 test plus the Task 5 manual check.

---

### Task 1: Monorepo root (ticket 0.1 part 1 — TOM-13)

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.npmrc`, `.editorconfig`, `.prettierrc`, `eslint.config.js`, `.node-version`
- Modify: `.gitignore` (add `worker-configuration.d.ts`, `.wrangler/`, `.dev.vars`, `coverage/`)

**Interfaces:**
- Produces: root scripts `pnpm typecheck`, `pnpm test`, `pnpm lint`, `pnpm format` that recurse into every workspace package; `tsconfig.base.json` that every package extends.

- [ ] **Step 1: Verify tool versions**

Run: `node -v && pnpm -v && docker --version && neonctl --version && op --version && hono --version`
Expected: Node ≥ 22, pnpm ≥ 9, Docker present, neonctl present, op present, hono 0.1.x. If `pnpm` is missing: `corepack enable && corepack prepare pnpm@latest --activate`. If `neonctl` is missing: `npm i -g neonctl`.

- [ ] **Step 2: Create the workspace files**

`pnpm-workspace.yaml`:
```yaml
packages:
  - "apps/*"
  - "packages/*"
```

`package.json`:
```json
{
  "name": "collaborative-gis",
  "private": true,
  "packageManager": "pnpm@9.15.4",
  "engines": { "node": ">=22" },
  "scripts": {
    "typecheck": "pnpm -r --if-present typecheck",
    "test": "pnpm -r --if-present test",
    "lint": "eslint .",
    "format": "prettier --write .",
    "format:check": "prettier --check ."
  },
  "devDependencies": {
    "@eslint/js": "^9.17.0",
    "eslint": "^9.17.0",
    "prettier": "^3.4.2",
    "typescript": "^5.7.2",
    "typescript-eslint": "^8.19.0"
  }
}
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true
  }
}
```

`.npmrc`:
```
auto-install-peers=true
strict-peer-dependencies=false
```

`.node-version`:
```
22
```

`.editorconfig`:
```
root = true
[*]
indent_style = space
indent_size = 2
end_of_line = lf
charset = utf-8
trim_trailing_whitespace = true
insert_final_newline = true
```

`.prettierrc`:
```json
{ "semi": true, "singleQuote": true, "printWidth": 100, "trailingComma": "all" }
```

`eslint.config.js`:
```js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/.wrangler/**', '**/node_modules/**', '**/worker-configuration.d.ts', '**/routeTree.gen.ts'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
);
```

Append to `.gitignore`:
```
worker-configuration.d.ts
.wrangler/
.dev.vars
coverage/
```

- [ ] **Step 3: Install and verify the root scripts run on an empty workspace**

Run: `pnpm install && pnpm typecheck && pnpm lint && pnpm format:check`
Expected: install succeeds; `typecheck` prints nothing (no packages yet); `lint` exits 0; `format:check` exits 0 (run `pnpm format` first if it lists files).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: pnpm workspace root with shared tsconfig, eslint, prettier

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Shared contracts package (ticket 0.2 — TOM-14)

**Files:**
- Create: `packages/shared/package.json`, `packages/shared/tsconfig.json`, `packages/shared/vitest.config.ts`, `packages/shared/src/index.ts`, `packages/shared/src/geo.ts`, `packages/shared/src/area.ts`, `packages/shared/src/api.ts`, `packages/shared/src/ws.ts`
- Test: `packages/shared/src/geo.test.ts`, `packages/shared/src/ws.test.ts`

**Interfaces:**
- Produces (imported by every later task as `@cgis/shared`):
  - `PolygonSchema: z.ZodType<Polygon>` where `Polygon = { type: 'Polygon'; coordinates: [number, number][][] }` (GeoJSON, one outer ring, `[lng, lat]`).
  - `POLYGON_MAX_VERTICES = 1000`.
  - `AreaSchema`, `Area = { id: string; name: string; geometry: Polygon; areaKm2: number; version: number; createdBy: string; createdAt: string; updatedAt: string }`.
  - `AreaCreateSchema = { name: string; geometry: Polygon }`, `AreaUpdateSchema = AreaCreateSchema & { version: number }`.
  - `BoundsQuerySchema` parsing `{ bbox: string; zoom?: string }` into `{ bbox: [w, s, e, n]; zoom?: number }`.
  - `ApiErrorSchema`, `ApiError = { code: string; message: string; details?: unknown }`.
  - `WsEnvelopeSchema`, `WsEventType` union, `WsEvent` discriminated union, `parseWsMessage(raw: string): WsEvent` (throws `ZodError`).

- [ ] **Step 1: Create the package skeleton**

`packages/shared/package.json`:
```json
{
  "name": "@cgis/shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "typecheck": "tsc -p tsconfig.json",
    "test": "vitest run"
  },
  "dependencies": { "zod": "^3.24.1" },
  "devDependencies": { "vitest": "^3.0.5", "typescript": "^5.7.2" }
}
```

`packages/shared/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "include": ["src"] }
```

`packages/shared/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['src/**/*.test.ts'] } });
```

Run: `pnpm install`

- [ ] **Step 2: Write the failing polygon tests**

`packages/shared/src/geo.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { POLYGON_MAX_VERTICES, PolygonSchema } from './geo';

const square = (n = 0) => ({
  type: 'Polygon' as const,
  coordinates: [[[34.8 + n, 32.0], [34.9 + n, 32.0], [34.9 + n, 32.1], [34.8 + n, 32.1], [34.8 + n, 32.0]]],
});

describe('PolygonSchema', () => {
  it('accepts a closed square near Tel Aviv', () => {
    expect(PolygonSchema.safeParse(square()).success).toBe(true);
  });

  it('rejects an unclosed ring and names the rule', () => {
    const open = square();
    open.coordinates[0] = open.coordinates[0].slice(0, -1);
    const r = PolygonSchema.safeParse(open);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toMatch(/closed/i);
  });

  it('rejects fewer than 3 unique vertices', () => {
    const line = { type: 'Polygon' as const, coordinates: [[[34.8, 32.0], [34.9, 32.0], [34.8, 32.0]]] };
    expect(PolygonSchema.safeParse(line).success).toBe(false);
  });

  it('rejects out-of-range longitude', () => {
    const bad = square();
    bad.coordinates[0]![0] = [181, 32.0];
    expect(PolygonSchema.safeParse(bad).success).toBe(false);
  });

  it('accepts exactly 1000 vertices and rejects 1001', () => {
    const ring = (n: number) => {
      const pts: [number, number][] = [];
      for (let i = 0; i < n - 1; i++) {
        const a = (i / (n - 1)) * 2 * Math.PI;
        pts.push([34.85 + 0.01 * Math.cos(a), 32.05 + 0.01 * Math.sin(a)]);
      }
      pts.push(pts[0]!);
      return { type: 'Polygon' as const, coordinates: [pts] };
    };
    expect(PolygonSchema.safeParse(ring(POLYGON_MAX_VERTICES)).success).toBe(true);
    expect(PolygonSchema.safeParse(ring(POLYGON_MAX_VERTICES + 1)).success).toBe(false);
  });

  it('cannot detect swapped lng/lat when both are in range (documented limitation)', () => {
    const swapped = { type: 'Polygon' as const, coordinates: [[[32.0, 34.8], [32.0, 34.9], [32.1, 34.9], [32.0, 34.8]]] };
    expect(PolygonSchema.safeParse(swapped).success).toBe(true);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --filter @cgis/shared test`
Expected: FAIL with "Cannot find module './geo'".

- [ ] **Step 4: Implement `geo.ts`**

`packages/shared/src/geo.ts`:
```ts
import { z } from 'zod';

export const POLYGON_MAX_VERTICES = 1000;

export const PositionSchema = z.tuple([
  z.number().min(-180).max(180), // lng
  z.number().min(-90).max(90), // lat
]);
export type Position = z.infer<typeof PositionSchema>;

const RingSchema = z
  .array(PositionSchema)
  .min(4, 'A ring needs at least 3 unique vertices plus the closing vertex')
  .max(POLYGON_MAX_VERTICES, `A ring may have at most ${POLYGON_MAX_VERTICES} vertices`)
  .refine((r) => r[0]![0] === r[r.length - 1]![0] && r[0]![1] === r[r.length - 1]![1], {
    message: 'Ring must be closed: first and last vertex must be equal',
  })
  .refine((r) => new Set(r.slice(0, -1).map((p) => `${p[0]},${p[1]}`)).size >= 3, {
    message: 'Ring needs at least 3 unique vertices',
  });

export const PolygonSchema = z.object({
  type: z.literal('Polygon'),
  coordinates: z.tuple([RingSchema]), // ponytail: outer ring only; holes are out of scope for the brief
});
export type Polygon = z.infer<typeof PolygonSchema>;
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @cgis/shared test`
Expected: 6 passed.

- [ ] **Step 6: Write the failing WebSocket envelope test**

`packages/shared/src/ws.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { parseWsMessage } from './ws';

describe('parseWsMessage', () => {
  it('parses a join event', () => {
    const ev = parseWsMessage(JSON.stringify({ type: 'join', seq: 1, ts: 1700000000000, payload: { mapId: 'default' } }));
    expect(ev.type).toBe('join');
  });

  it('rejects an unknown type', () => {
    expect(() => parseWsMessage(JSON.stringify({ type: 'nope', seq: 1, ts: 1, payload: {} }))).toThrow();
  });

  it('rejects a draft:update whose vertex is out of range', () => {
    const raw = JSON.stringify({ type: 'draft:update', seq: 2, ts: 1, payload: { op: 'add', index: 0, vertex: [200, 0] } });
    expect(() => parseWsMessage(raw)).toThrow();
  });
});
```

- [ ] **Step 7: Run to verify it fails**

Run: `pnpm --filter @cgis/shared test`
Expected: FAIL with "Cannot find module './ws'".

- [ ] **Step 8: Implement `area.ts`, `api.ts`, `ws.ts`, `index.ts`**

`packages/shared/src/area.ts`:
```ts
import { z } from 'zod';
import { PolygonSchema } from './geo';

export const AreaSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  geometry: PolygonSchema,
  areaKm2: z.number().nonnegative(),
  version: z.number().int().positive(),
  createdBy: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Area = z.infer<typeof AreaSchema>;

export const AreaCreateSchema = AreaSchema.pick({ name: true, geometry: true });
export type AreaCreate = z.infer<typeof AreaCreateSchema>;

export const AreaUpdateSchema = AreaCreateSchema.extend({ version: z.number().int().positive() });
export type AreaUpdate = z.infer<typeof AreaUpdateSchema>;

export const BoundsQuerySchema = z.object({
  bbox: z
    .string()
    .transform((s) => s.split(',').map(Number))
    .pipe(z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90), z.number().min(-180).max(180), z.number().min(-90).max(90)]))
    .refine(([w, s, e, n]) => w < e && s < n, { message: 'bbox must be w,s,e,n with w<e and s<n' }),
  zoom: z.coerce.number().int().min(0).max(22).optional(),
});
export type BoundsQuery = z.infer<typeof BoundsQuerySchema>;
```

`packages/shared/src/api.ts`:
```ts
import { z } from 'zod';

export const ApiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;
```

`packages/shared/src/ws.ts`:
```ts
import { z } from 'zod';
import { AreaSchema } from './area';
import { PositionSchema } from './geo';

const base = { seq: z.number().int().nonnegative(), ts: z.number().int().nonnegative() };

export const PresenceUserSchema = z.object({
  userId: z.string(),
  name: z.string(),
  color: z.string().regex(/^#[0-9a-f]{6}$/i),
  state: z.enum(['viewing', 'drawing']),
});
export type PresenceUser = z.infer<typeof PresenceUserSchema>;

export const WsEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('join'), ...base, payload: z.object({ mapId: z.string() }) }),
  z.object({ type: z.literal('leave'), ...base, payload: z.object({}) }),
  z.object({ type: z.literal('presence'), ...base, payload: z.object({ users: z.array(PresenceUserSchema) }) }),
  z.object({
    type: z.literal('draft:update'),
    ...base,
    payload: z.discriminatedUnion('op', [
      z.object({ op: z.literal('add'), index: z.number().int().nonnegative(), vertex: PositionSchema }),
      z.object({ op: z.literal('move'), index: z.number().int().nonnegative(), vertex: PositionSchema }),
      z.object({ op: z.literal('remove'), index: z.number().int().nonnegative() }),
      z.object({ op: z.literal('clear') }),
    ]),
  }),
  z.object({ type: z.literal('area:created'), ...base, payload: z.object({ area: AreaSchema }) }),
  z.object({ type: z.literal('area:updated'), ...base, payload: z.object({ area: AreaSchema }) }),
  z.object({ type: z.literal('area:deleted'), ...base, payload: z.object({ id: z.string().uuid() }) }),
  z.object({ type: z.literal('error'), ...base, payload: z.object({ code: z.string(), message: z.string(), retryAfter: z.number().optional() }) }),
]);
export type WsEvent = z.infer<typeof WsEventSchema>;
export type WsEventType = WsEvent['type'];

export function parseWsMessage(raw: string): WsEvent {
  return WsEventSchema.parse(JSON.parse(raw));
}
```

`packages/shared/src/index.ts`:
```ts
export * from './geo';
export * from './area';
export * from './api';
export * from './ws';
```

- [ ] **Step 9: Run tests and typecheck**

Run: `pnpm --filter @cgis/shared test && pnpm --filter @cgis/shared typecheck`
Expected: 9 passed; typecheck clean.

- [ ] **Step 10: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): Zod contracts for polygon, area, bounds query, api error, ws events

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Hono Worker scaffold with health endpoints (ticket 0.1 part 2 — TOM-13; readiness probe from 2.8 is stubbed here)

**Files:**
- Create: `apps/api/` via `hono init`, then `apps/api/src/index.ts`, `apps/api/src/app.ts`, `apps/api/src/routes/health.ts`, `apps/api/wrangler.jsonc`, `apps/api/vitest.config.ts`, `apps/api/tsconfig.json`, `apps/api/AGENTS.md`
- Test: `apps/api/test/health.test.ts`

**Interfaces:**
- Consumes: `ApiError` from `@cgis/shared`.
- Produces: `createApp(): Hono<{ Bindings: Env }>` in `src/app.ts`; `Env` type with `HYPERDRIVE: Hyperdrive` (added in Task 5) ; routes `GET /healthz` → `{ ok: true }` 200, `GET /readyz` → `{ ok: true, db: 'up' }` 200 or `ApiError` 503. Worker default export `{ fetch: app.fetch }` in `src/index.ts`.

- [ ] **Step 1: Scaffold with the Hono CLI**

Run:
```bash
mkdir -p apps/api && cd apps/api && hono init -t cloudflare-workers -i && cd ../..
```
Expected: `apps/api/src/index.ts`, `apps/api/wrangler.jsonc` (or `.toml`), `apps/api/package.json` with `hono`, `wrangler`, `@hono/cli`, and an `AGENTS.md`. If the template wrote `wrangler.toml`, delete it and create `wrangler.jsonc` as below. Set `"name": "@cgis/api"` in `apps/api/package.json`.

- [ ] **Step 2: Add dependencies and scripts**

Run:
```bash
pnpm --filter @cgis/api add @cgis/shared@workspace:* zod
pnpm --filter @cgis/api add -D @cloudflare/vitest-pool-workers vitest @cloudflare/workers-types typescript
```
Set `apps/api/package.json` scripts to:
```json
{
  "dev": "wrangler dev",
  "deploy": "wrangler deploy --minify",
  "types": "wrangler types --env-interface CloudflareBindings",
  "typecheck": "pnpm types && tsc -p tsconfig.json",
  "test": "vitest run"
}
```

`apps/api/wrangler.jsonc`:
```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "collaborative-gis-api",
  "main": "src/index.ts",
  "compatibility_date": "2026-09-01",
  "compatibility_flags": ["nodejs_compat"],
  "observability": { "enabled": true }
}
```

`apps/api/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "types": ["@cloudflare/workers-types/2023-07-01", "vitest/globals"] },
  "include": ["src", "test", "worker-configuration.d.ts"]
}
```

`apps/api/vitest.config.ts`:
```ts
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    include: ['test/**/*.test.ts'],
    poolOptions: { workers: { wrangler: { configPath: './wrangler.jsonc' } } },
  },
});
```

`apps/api/AGENTS.md` (replace template content):
```md
## Hono CLI

Run `npx hono --help` first, and use the CLI instead of a dev server.

- `hono routes` lists routes. `hono request /healthz` sends a request in-process.
- `hono batch - <<'JSONL' ... JSONL` runs a request script; rerun until `"failed": 0`.
- The app runs on Cloudflare workerd. Never import Node-only modules outside `nodejs_compat`.
```

- [ ] **Step 3: Write the failing health tests**

`apps/api/test/health.test.ts`:
```ts
import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

describe('health', () => {
  it('GET /healthz returns 200 ok', async () => {
    const res = await SELF.fetch('http://x/healthz');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('GET /readyz returns 503 ApiError when the database check throws', async () => {
    // No HYPERDRIVE binding is configured in this task, so the probe must fail closed.
    const res = await SELF.fetch('http://x/readyz');
    expect(res.status).toBe(503);
    const body = (await res.json()) as { code: string; message: string };
    expect(body.code).toBe('NOT_READY');
    expect(typeof body.message).toBe('string');
  });

  it('unknown route returns 404 ApiError', async () => {
    const res = await SELF.fetch('http://x/nope');
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe('NOT_FOUND');
  });
});
```

- [ ] **Step 4: Run to verify they fail**

Run: `pnpm --filter @cgis/api test`
Expected: FAIL (template `/` route exists, `/healthz` 404 with HTML/text body → JSON parse error or status mismatch).

- [ ] **Step 5: Implement the app**

`apps/api/src/app.ts`:
```ts
import type { ApiError } from '@cgis/shared';
import { Hono } from 'hono';
import { health } from './routes/health';

export type Env = {
  // HYPERDRIVE is added in Task 5; optional here so /readyz fails closed without it.
  HYPERDRIVE?: Hyperdrive;
};

export function createApp() {
  const app = new Hono<{ Bindings: Env }>();

  app.route('/', health);

  app.notFound((c) => c.json<ApiError>({ code: 'NOT_FOUND', message: `No route for ${c.req.method} ${c.req.path}` }, 404));

  app.onError((err, c) => {
    console.error(JSON.stringify({ level: 'error', msg: err.message, path: c.req.path }));
    return c.json<ApiError>({ code: 'INTERNAL', message: 'Internal Server Error' }, 500);
  });

  return app;
}
```

`apps/api/src/routes/health.ts`:
```ts
import type { ApiError } from '@cgis/shared';
import { Hono } from 'hono';
import type { Env } from '../app';

export const health = new Hono<{ Bindings: Env }>();

health.get('/healthz', (c) => c.json({ ok: true }));

health.get('/readyz', async (c) => {
  try {
    await checkDatabase(c.env);
    return c.json({ ok: true, db: 'up' });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json<ApiError>({ code: 'NOT_READY', message }, 503);
  }
});

// ponytail: real query lands in Task 5 once HYPERDRIVE exists; until then the probe fails closed.
export async function checkDatabase(env: Env): Promise<void> {
  if (!env.HYPERDRIVE) throw new Error('HYPERDRIVE binding is not configured');
  const { Client } = await import('pg');
  const client = new Client({ connectionString: env.HYPERDRIVE.connectionString });
  await client.connect();
  try {
    await client.query('select 1');
  } finally {
    await client.end();
  }
}
```

`apps/api/src/index.ts`:
```ts
import { createApp } from './app';

const app = createApp();

export default {
  fetch: app.fetch,
} satisfies ExportedHandler<CloudflareBindings>;
```

Run: `pnpm --filter @cgis/api add pg && pnpm --filter @cgis/api add -D @types/pg`

- [ ] **Step 6: Run tests, typecheck, and the Hono CLI**

Run: `pnpm --filter @cgis/api test && pnpm --filter @cgis/api typecheck`
Expected: 3 passed; typecheck clean (`wrangler types` generates `worker-configuration.d.ts`).

Run (from `apps/api`): `hono routes && hono request /healthz`
Expected: routes JSON lists `GET /healthz`, `GET /readyz`; request returns `{"ok":true}` with status 200.

- [ ] **Step 7: Commit**

```bash
git add apps/api pnpm-lock.yaml
git commit -m "feat(api): Hono Worker scaffold with /healthz and fail-closed /readyz

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Vite React placeholder (ticket 0.1 part 3 — TOM-13)

**Files:**
- Create: `apps/web/` via `pnpm create vite`, then `apps/web/src/App.tsx`, `apps/web/src/App.test.tsx`, `apps/web/vitest.config.ts`
- Modify: `apps/web/package.json`, `apps/web/tsconfig.json`

**Interfaces:**
- Produces: `apps/web` builds with `pnpm --filter @cgis/web build`; `App` renders the text "Collaborative GIS" and imports a type from `@cgis/shared` to prove workspace linking. TanStack Router, Leaflet and the Cloudflare Vite plugin are added in M1 (ticket 5.1), not here.

- [ ] **Step 1: Scaffold**

Run:
```bash
pnpm create vite@latest apps/web --template react-ts
pnpm --filter ./apps/web add @cgis/shared@workspace:*
pnpm --filter ./apps/web add -D vitest @testing-library/react @testing-library/jest-dom jsdom
```
Set `"name": "@cgis/web"` in `apps/web/package.json` and scripts:
```json
{ "dev": "vite", "build": "tsc -b && vite build", "preview": "vite preview", "typecheck": "tsc -b", "test": "vitest run" }
```
Set `apps/web/tsconfig.app.json` `"extends": "../../tsconfig.base.json"` (keep the template's `lib`, `jsx`, `include`).

- [ ] **Step 2: Write the failing test**

`apps/web/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
export default defineConfig({ plugins: [react()], test: { environment: 'jsdom', include: ['src/**/*.test.tsx'] } });
```

`apps/web/src/App.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import App from './App';

it('renders the app title and the vertex cap from shared contracts', () => {
  render(<App />);
  expect(screen.getByRole('heading', { name: /collaborative gis/i })).toBeTruthy();
  expect(screen.getByText(/1000 vertices/)).toBeTruthy();
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm --filter @cgis/web test`
Expected: FAIL (template App shows "Vite + React").

- [ ] **Step 4: Implement**

`apps/web/src/App.tsx`:
```tsx
import { POLYGON_MAX_VERTICES } from '@cgis/shared';

export default function App() {
  return (
    <main>
      <h1>Collaborative GIS</h1>
      <p>Polygons may have up to {POLYGON_MAX_VERTICES} vertices.</p>
    </main>
  );
}
```
Delete `apps/web/src/App.css` and its import in `main.tsx` if present; keep `index.css`.

- [ ] **Step 5: Run test, typecheck, build**

Run: `pnpm --filter @cgis/web test && pnpm --filter @cgis/web typecheck && pnpm --filter @cgis/web build`
Expected: 1 passed; build writes `apps/web/dist`.

- [ ] **Step 6: Commit**

```bash
git add apps/web pnpm-lock.yaml
git commit -m "feat(web): Vite React placeholder linked to shared contracts

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Databases — local PostGIS, Neon project, Hyperdrive local binding (ticket 0.3 — TOM-15)

**Files:**
- Create: `docker-compose.yml`, `.env.example`, `scripts/db-check.sh`, `apps/api/.dev.vars.example`
- Modify: `apps/api/wrangler.jsonc` (hyperdrive binding), `apps/api/src/app.ts` (make `HYPERDRIVE` required), `apps/api/test/health.test.ts` (readyz now expects 200 when the DB is up)

**Interfaces:**
- Produces: `env.HYPERDRIVE.connectionString` available in the Worker; `pnpm db:up`, `pnpm db:check` root scripts; Neon project `collaborative-gis` with PostGIS enabled; the Hyperdrive config id recorded in `wrangler.jsonc`.

- [ ] **Step 1: docker-compose and env example**

`docker-compose.yml`:
```yaml
services:
  postgis:
    image: postgis/postgis:16-3.4
    environment:
      POSTGRES_USER: cgis
      POSTGRES_PASSWORD: cgis
      POSTGRES_DB: cgis
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U cgis -d cgis"]
      interval: 5s
      timeout: 3s
      retries: 10
    volumes:
      - postgis-data:/var/lib/postgresql/data
volumes:
  postgis-data:
```

`.env.example`:
```
# Local (docker-compose)
LOCAL_DATABASE_URL=postgresql://cgis:cgis@localhost:5432/cgis
# Neon direct (migrations only; never used by the Worker at runtime)
NEON_DATABASE_URL=
# Neon API key: read from 1Password at use time, do not store here
# NEON_API_KEY=$(op read "op://Dev/tomercouch-neon/credential")
```

Add root scripts to `package.json`:
```json
"db:up": "docker compose up -d postgis",
"db:down": "docker compose down",
"db:check": "bash scripts/db-check.sh"
```

`scripts/db-check.sh`:
```bash
#!/usr/bin/env bash
set -euo pipefail
URL="${1:-postgresql://cgis:cgis@localhost:5432/cgis}"
docker compose exec -T postgis psql "$URL" -v ON_ERROR_STOP=1 -c "create extension if not exists postgis;" -c "select postgis_version();"
```
Run: `chmod +x scripts/db-check.sh && pnpm db:up && sleep 8 && pnpm db:check`
Expected: a `postgis_version` row like `3.4 USE_GEOS=1 ...`.

- [ ] **Step 2: Create the Neon project and enable PostGIS**

Run (values never printed):
```bash
export NEON_API_KEY="$(op read 'op://Dev/tomercouch-neon/credential')"
neonctl projects create --name collaborative-gis --region-id aws-eu-central-1 --output json > /tmp/neon-project.json
NEON_PROJECT_ID=$(python3 -c "import json;print(json.load(open('/tmp/neon-project.json'))['project']['id'])")
neonctl set-context --project-id "$NEON_PROJECT_ID"
NEON_DIRECT_URL="$(neonctl connection-string --pooled false)"
psql "$NEON_DIRECT_URL" -v ON_ERROR_STOP=1 -c "create extension if not exists postgis;" -c "select postgis_version();"
rm /tmp/neon-project.json
```
Expected: PostGIS version row from Neon. If `psql` is missing locally: `docker compose exec -T postgis psql "$NEON_DIRECT_URL" ...` works too.
Record only the **project id** in `docs/process-log.md`; the URL stays in your shell and in `.env` (git-ignored).

- [ ] **Step 3: Hyperdrive binding**

Run:
```bash
cd apps/api && wrangler hyperdrive create cgis-neon --connection-string="$NEON_DIRECT_URL" --output json
```
Copy the returned `id` into `apps/api/wrangler.jsonc`:
```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "collaborative-gis-api",
  "main": "src/index.ts",
  "compatibility_date": "2026-09-01",
  "compatibility_flags": ["nodejs_compat"],
  "observability": { "enabled": true },
  "hyperdrive": [
    {
      "binding": "HYPERDRIVE",
      "id": "<id from wrangler hyperdrive create>",
      "localConnectionString": "postgresql://cgis:cgis@localhost:5432/cgis"
    }
  ]
}
```
In `apps/api/src/app.ts` change `HYPERDRIVE?: Hyperdrive;` to `HYPERDRIVE: Hyperdrive;` and in `checkDatabase` replace `select 1` with `select postgis_version()`. Remove the `if (!env.HYPERDRIVE)` guard.

- [ ] **Step 4: Update the readiness test to the real behaviour**

Replace the second test in `apps/api/test/health.test.ts` with:
```ts
  it('GET /readyz returns 200 with db up when PostGIS answers', async () => {
    const res = await SELF.fetch('http://x/readyz');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, db: 'up' });
  });

  it('GET /readyz returns 503 ApiError when the connection string is unreachable', async () => {
    const { createApp } = await import('../src/app');
    const app = createApp();
    const res = await app.request('http://x/readyz', {}, {
      HYPERDRIVE: { connectionString: 'postgresql://nobody:x@127.0.0.1:1/none' } as Hyperdrive,
    });
    expect(res.status).toBe(503);
    expect(((await res.json()) as { code: string }).code).toBe('NOT_READY');
  });
```

- [ ] **Step 5: Run the tests with the local database up**

Run: `pnpm db:up && pnpm --filter @cgis/api test && pnpm --filter @cgis/api typecheck`
Expected: 4 passed (the vitest workers pool honours `localConnectionString`).

Run (from `apps/api`): `wrangler dev --local` in one terminal, then `curl -s localhost:8787/readyz`
Expected: `{"ok":true,"db":"up"}`. Stop the compose database (`pnpm db:down`) and curl again: 503 with `NOT_READY`; `/healthz` still 200. Restart it: `pnpm db:up`.

- [ ] **Step 6: Commit**

```bash
git add docker-compose.yml .env.example scripts apps/api
git commit -m "feat(db): local PostGIS via compose, Neon project with PostGIS, Hyperdrive binding, real /readyz

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: CI (ticket 0.4 — TOM-16)

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Produces: a required check `ci` on every pull request and push to `main` running lint, typecheck, unit tests for all packages (with a PostGIS service for the Worker tests), and `wrangler deploy --dry-run`.

- [ ] **Step 1: Write the workflow**

`.github/workflows/ci.yml`:
```yaml
name: ci
on:
  pull_request:
  push:
    branches: [main]
jobs:
  ci:
    runs-on: ubuntu-latest
    services:
      postgis:
        image: postgis/postgis:16-3.4
        env:
          POSTGRES_USER: cgis
          POSTGRES_PASSWORD: cgis
          POSTGRES_DB: cgis
        ports: ["5432:5432"]
        options: >-
          --health-cmd "pg_isready -U cgis -d cgis" --health-interval 5s --health-timeout 3s --health-retries 10
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: .node-version
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm format:check
      - run: pnpm typecheck
      - run: pnpm test
      - name: wrangler dry run
        run: pnpm --filter @cgis/api exec wrangler deploy --dry-run --outdir dist
```

- [ ] **Step 2: Verify locally what CI will run**

Run: `pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm --filter @cgis/api exec wrangler deploy --dry-run --outdir dist`
Expected: all green; dry run prints the bundle summary without uploading. Add `apps/api/dist/` to `.gitignore` if the dry run wrote it (the root `dist/` rule already covers it).

- [ ] **Step 3: Push and confirm**

Run: `git add .github && git commit -m "ci: lint, typecheck, test with PostGIS service, wrangler dry run

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" && git push -u origin main`
Expected: the `ci` job is green on GitHub (`gh run watch`). If the repository has no remote yet: `gh repo create collaborative-gis --private --source . --push`.

---

### Task 7: Docs skeleton and process log (ticket 0.5 — TOM-17)

**Files:**
- Create: `README.md`, `docs/adr/0000-template.md`, `docs/adr/0001-cloudflare-over-vercel.md`, `docs/adr/0002-hono-over-fastify.md`, `docs/adr/0003-leaflet-1-9-4-and-proj4-crs.md`
- Modify: `docs/process-log.md`

**Interfaces:**
- Produces: README with every heading from the submission checklist, filled where M0 already provides the answer (setup is real; later sections hold one sentence stating what will go there and which ticket fills it).

- [ ] **Step 1: README**

`README.md`:
```md
# Collaborative GIS

Real-time collaborative polygon drawing on Leaflet with OpenStreetMap and govmap aerial imagery. Hono on Cloudflare Workers + Durable Objects, PostGIS on Neon via Hyperdrive, Better Auth, React + Vite + TanStack.

Planning and decisions: `docs/roadmap.md`, `docs/research-notes.md`, `docs/superpowers/specs/2026-10-12-collaborative-gis-design.md`, `docs/decisions-brief.html`, `docs/process-log.md`, ADRs in `docs/adr/`.

## Setup

Prerequisites: Node 22, pnpm 9, Docker, Wrangler (installed by pnpm), Hono CLI (`npm i -g @hono/cli`).

```bash
pnpm install
pnpm db:up && pnpm db:check          # local PostGIS 16 / 3.4 with the extension enabled
pnpm --filter @cgis/api dev          # Worker on http://localhost:8787 (workerd, Hyperdrive → local PostGIS)
pnpm --filter @cgis/web dev          # Vite on http://localhost:5173
pnpm test && pnpm typecheck && pnpm lint
```

Database setup for Neon (production): create the project with `neonctl projects create`, enable PostGIS with `create extension if not exists postgis` over the **direct** connection, create a Hyperdrive config with `wrangler hyperdrive create`, and put its id in `apps/api/wrangler.jsonc`. Migrations always run against the direct URL (ticket 1.2); the Worker only ever sees the Hyperdrive binding.

Coordinate order: all GeoJSON in this project is `[longitude, latitude]`; Leaflet's own API is `[lat, lng]`. The shared schema cannot detect a swap when both values are in range.

## Technical decisions and architecture
See ADRs 0001–0003 and the spec. Filled further by tickets 4.9 and 6.5.

## Performance considerations
Spatial index, geodesic area, cache keys, benchmarks: tickets 1.3, 1.4, 1.7, 3.6, 6.6.

## Security measures
Tickets 2.1–2.8, 7.5.

## Known limitations
Filled by ticket 6.5.

## Future improvements and scaling
Ticket 4.9 ADR.

## Testing approach
Unit (Vitest), Worker + Durable Object integration (`@cloudflare/vitest-pool-workers`), API contract suite (`hono batch`), two-browser Playwright E2E: tickets 6.1–6.3.
```

- [ ] **Step 2: ADR template and the three decided ADRs**

`docs/adr/0000-template.md`:
```md
# ADR-NNNN: Title

Date: YYYY-MM-DD · Status: proposed | accepted | superseded by ADR-NNNN

## Context
What forces are at play; cite research notes or tickets.

## Decision
One paragraph, present tense.

## Consequences
Positive, negative, and what becomes easier or harder.
```

`docs/adr/0001-cloudflare-over-vercel.md`:
```md
# ADR-0001: Cloudflare Workers + Durable Objects instead of Vercel

Date: 2026-10-12 · Status: accepted

## Context
The brief requires a WebSocket server with presence and graceful degradation. Vercel serves WebSockets natively only in public beta (June 2026), pins a connection to one instance, and caps every connection at the function max duration (300 s Hobby, 800 s Pro), so clients must reconnect constantly and fan-out needs Redis (research notes, "Cloudflare" and "Vercel").

## Decision
Deploy a single Cloudflare Worker with one `Room` Durable Object per map using the WebSocket Hibernation API, a `RateLimiter` Durable Object per user, Hyperdrive to Neon PostGIS, and the Vite SPA as static assets.

## Consequences
No external broker; the room object is the coordinator (≈1,000 req/s soft limit; shard by tile if needed). The backend must be a fetch-runtime app (ADR-0002). Local parity is `wrangler dev` (workerd), not Node (decision D9).
```

`docs/adr/0002-hono-over-fastify.md`:
```md
# ADR-0002: Hono instead of Fastify

Date: 2026-10-12 · Status: accepted

## Context
Workers execute fetch handlers on workerd; Fastify needs a Node HTTP server. Hono is web-standard, runs on Workers and Node, ships an official agent skill and a CLI that tests the app in-process with local bindings.

## Decision
Build the API with Hono, validate with Zod via `hono-openapi`, document with OpenAPI 3.1, test with `hono batch` and `@cloudflare/vitest-pool-workers`.

## Consequences
No controllers; routes grouped with `app.route`; shared types through the `hc` client. WebSocket upgrades are forwarded to the Durable Object rather than handled by Hono's helper.
```

`docs/adr/0003-leaflet-1-9-4-and-proj4-crs.md`:
```md
# ADR-0003: Leaflet 1.9.4 and a hand-rolled EPSG:2039 CRS on proj4

Date: 2026-10-12 · Status: accepted

## Context
Leaflet 2.0 is alpha (ESM-only, factory functions removed, pointer events). Proj4Leaflet last shipped in 2017 and has no Leaflet 2 path. govmap aerial tiles are served on an Israeli TM (EPSG:2039) grid; the open-data WMS has no imagery layer.

## Decision
Use Leaflet 1.9.4. Implement the EPSG:2039 CRS directly on `proj4` (projection, transformation, resolutions) and a `TileLayer` subclass overriding `getTileUrl` for govmap's level/row/column scheme. Swap the map CRS when the aerial layer is active and re-add overlays from WGS84 state (decision D3, option A). No tile proxy and no fallback provider.

## Consequences
About 50 lines of CRS code we own; portable to Leaflet 2 later. The spike (ticket 5.4) must prove A end to end; if it is technically impossible the work stops for a new decision.
```

- [ ] **Step 3: Process log entry and commit**

Append to `docs/process-log.md`:
```
22. M0 executed: workspace root, shared contracts (9 tests), Hono Worker with health endpoints (4 tests), Vite placeholder (1 test), local + Neon PostGIS with Hyperdrive binding (Neon project id: <id>), CI green, README + ADR 0001–0003.
```

```bash
git add README.md docs
git commit -m "docs: README skeleton per submission checklist, ADR template, ADRs 0001-0003

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push
```

- [ ] **Step 4: Close the Linear tickets**

Move TOM-13, TOM-14, TOM-15, TOM-16, TOM-17 to Done via the `linear-personal` MCP (`save_issue` with `state: "Done"`), each with a one-line comment naming the commit hash.

---

## Self-review

**Spec coverage (M0 scope only):** §2 single Worker + Hyperdrive (Tasks 3, 5); §3 `packages/shared` contracts (Task 2); §6 `ApiError` shape and sanitised 5xx (Task 3); §8 test tooling bootstrapped (Tasks 2–5, 6); §10 decisions D2, D3, D9 recorded as ADRs (Task 7). Items deliberately deferred to M1 with their tickets: schema and migrations (1.1, 1.2), auth (2.1, 2.2), Room DO (4.x), map and draw tool (5.x). `/readyz` pinging the room DO (ticket 2.8) is deferred to M1 when the DO exists.

**Placeholders:** the only `<...>` values are the Hyperdrive id and the Neon project id, which are produced by commands in the same task.

**Type consistency:** `Env` has `HYPERDRIVE: Hyperdrive` after Task 5 (optional in Task 3 by design); `createApp()` is used in Task 5's test exactly as defined in Task 3; `POLYGON_MAX_VERTICES`, `PolygonSchema`, `parseWsMessage` names match between Tasks 2 and 4.

**Review Focus:** items 1–3 are pinned in Task 2's tests; items 4–5 in Task 3 and Task 5's tests plus the manual `wrangler dev` check.
