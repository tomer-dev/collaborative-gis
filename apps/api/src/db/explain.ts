// Node-only, like migrate.ts; the Worker never imports this file.
// CLI: `DATABASE_URL=<direct URL> pnpm --filter @cgis/api db:explain`. Seeds the table up to
// BENCH.ROWS, analyses it, runs EXPLAIN (ANALYZE, FORMAT JSON) on the bounds query BENCH.RUNS times
// with the planner's own plan (the GiST index) and BENCH.RUNS times with index scans switched off,
// and writes the table between the markers in docs/benchmarks.md.
import { readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { BENCH, LIMITS } from '@cgis/shared';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { z } from 'zod';
import { db } from './index.ts';
import { seedAreas } from './seed.ts';
import { boundsQuery } from './spatial-read.ts';

const OUTPUT = new URL('../../../../docs/benchmarks.md', import.meta.url);
const START = '<!-- bounds-explain:start -->';
const END = '<!-- bounds-explain:end -->';
const INDEX_NAME = 'areas_geom_gist';

type PlanNode = z.infer<typeof PlanNodeSchema>;
const PlanNodeSchema = z.object({
  'Node Type': z.string(),
  'Relation Name': z.string().optional(),
  'Index Name': z.string().optional(),
  'Actual Rows': z.number(),
  get Plans(): z.ZodOptional<z.ZodArray<typeof PlanNodeSchema>> {
    return z.array(PlanNodeSchema).optional();
  },
});
const ExplainSchema = z.tuple([z.object({ Plan: PlanNodeSchema, 'Execution Time': z.number() })]);

/** One plan's measurement: what scanned `areas`, how many rows came back, and the timings. */
type Measurement = { label: string; scans: string[]; rows: number; p50: number; p95: number };

const nodesOf = (node: PlanNode): PlanNode[] => [node, ...(node.Plans ?? []).flatMap(nodesOf)];

/** Nearest-rank percentile of `values` (0 < p ≤ 1). */
function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(p * sorted.length) - 1] ?? Number.NaN;
}

/**
 * Runs the bounds query `BENCH.RUNS` times under EXPLAIN ANALYZE with the given planner settings
 * switched off (`SET LOCAL`, inside a transaction that is rolled back).
 */
async function measure(client: pg.Client, label: string, off: string[]): Promise<Measurement> {
  const query = sql`EXPLAIN (ANALYZE, FORMAT JSON) ${boundsQuery(client, BENCH.VIEWPORT)}`;
  await client.query('begin');
  try {
    for (const setting of off) await client.query(`set local ${setting} = off`);
    const runs = [];
    for (let run = 0; run < BENCH.RUNS; run++) {
      const { rows } = await db(client).execute(query);
      runs.push(ExplainSchema.parse(rows[0]?.['QUERY PLAN'])[0]);
    }
    const nodes = runs.flatMap((r) => nodesOf(r.Plan));
    const scans = [
      ...new Set(
        nodes
          .filter((n) => n['Relation Name'] ?? n['Index Name'])
          .map((n) => `${n['Node Type']} on ${n['Index Name'] ?? n['Relation Name']}`),
      ),
    ];
    const times = runs.map((r) => r['Execution Time']);
    return {
      label,
      scans,
      rows: runs[0]?.Plan['Actual Rows'] ?? 0,
      p50: percentile(times, 0.5),
      p95: percentile(times, 0.95),
    };
  } finally {
    await client.query('rollback');
  }
}

async function facts(client: pg.Client) {
  const { rows } = await client.query<{ live: number; server: string; postgis: string }>(
    `select (select count(*)::int from areas where deleted_at is null) as live,
       version() as server, postgis_lib_version() as postgis`,
  );
  const row = z
    .object({ live: z.number(), server: z.string(), postgis: z.string() })
    .parse(rows[0]);
  const cpus = os.cpus();
  const machine = [
    `${cpus[0]?.model ?? 'unknown CPU'}, ${cpus.length} cores, ${Math.round(os.totalmem() / 2 ** 30)} GB RAM`,
    `${os.type()} ${os.release()} ${os.arch()}, Node ${process.version}`,
    `${row.server.split(', compiled by')[0]}, PostGIS ${row.postgis}`,
  ].join('; ');
  return { live: row.live, machine };
}

function section(live: number, machine: string, results: Measurement[]): string {
  const ms = (value: number) => value.toFixed(2);
  const lines = [
    START,
    '',
    '## Bounds query: GiST index vs none',
    '',
    `\`selectAreasInBounds\` (\`GET /api/areas?bbox=…\`, \`LIMIT ${LIMITS.BOUNDS_LIMIT}\`) over the viewport \`BENCH.VIEWPORT\` = \`[${BENCH.VIEWPORT.join(', ')}]\`, with ${live.toLocaleString('en-US')} live areas in the table (random polygons from \`db:seed\`). Each plan ran ${BENCH.RUNS} times under \`EXPLAIN (ANALYZE, FORMAT JSON)\`; the times are the server's \`Execution Time\` (no network, no planning). Budget: p95 under ${BENCH.BOUNDS_P95_MS} ms (\`BENCH.BOUNDS_P95_MS\`), recorded, not asserted.`,
    '',
    '"Index scans off" runs with `SET LOCAL enable_indexscan = off` and `enable_bitmapscan = off`: `enable_indexscan` alone leaves the bitmap index scan, which is the plan the planner picks here.',
    '',
    '| Plan | Scan nodes | Rows returned | p50 (ms) | p95 (ms) | p95 within budget |',
    '| --- | --- | ---: | ---: | ---: | --- |',
    ...results.map(
      (r) =>
        `| ${r.label} | ${r.scans.join('; ')} | ${r.rows} | ${ms(r.p50)} | ${ms(r.p95)} | ${r.p95 < BENCH.BOUNDS_P95_MS ? 'yes' : 'no'} |`,
    ),
    '',
    `Measured ${new Date().toISOString().slice(0, 10)} with \`pnpm --filter @cgis/api db:explain\` on: ${machine}.`,
    '',
    END,
  ];
  return lines.join('\n');
}

/** Replaces the marked section of docs/benchmarks.md; throws when a marker is missing. */
async function write(text: string): Promise<void> {
  const current = await readFile(OUTPUT, 'utf8');
  const [start, end] = [current.indexOf(START), current.indexOf(END)];
  if (start < 0 || end < start) throw new Error(`docs/benchmarks.md lacks ${START} or ${END}`);
  await writeFile(OUTPUT, `${current.slice(0, start)}${text}${current.slice(end + END.length)}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set (use the direct database URL, not Hyperdrive)');
    process.exit(1);
  }
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await seedAreas(client, { count: BENCH.ROWS });
    await client.query('analyze areas');
    const withIndex = await measure(client, 'Planner default', []);
    // enable_indexscan alone leaves bitmap index scans, the plan the planner picks here.
    const withoutIndex = await measure(client, 'Index scans off', [
      'enable_indexscan',
      'enable_bitmapscan',
    ]);
    if (!withIndex.scans.some((s) => s.endsWith(INDEX_NAME))) {
      throw new Error(`the default plan does not use ${INDEX_NAME}: ${withIndex.scans.join('; ')}`);
    }
    if (withoutIndex.scans.some((s) => s.endsWith(INDEX_NAME))) {
      throw new Error(`index scans off still used ${INDEX_NAME}`);
    }
    const { live, machine } = await facts(client);
    await write(section(live, machine, [withIndex, withoutIndex]));
    console.log(JSON.stringify([withIndex, withoutIndex]));
  } finally {
    await client.end();
  }
}
