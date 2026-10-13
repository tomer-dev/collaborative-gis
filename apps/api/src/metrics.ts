import { TELEMETRY } from '@cgis/shared';

/** A `TELEMETRY.EVENTS` value: `blob1` and the index of a datapoint. */
export type MetricEvent = (typeof TELEMETRY.EVENTS)[keyof typeof TELEMETRY.EVENTS];

/** A `TELEMETRY.DB_OPS` value: which areas path a `DB_QUERY` datapoint timed. */
export type DbOp = (typeof TELEMETRY.DB_OPS)[keyof typeof TELEMETRY.DB_OPS];

/** Anything carrying the `METRICS` binding; optional, so a caller without one still type-checks. */
type MetricsEnv = { METRICS?: AnalyticsEngineDataset };

/**
 * Writes one Analytics Engine datapoint `{ indexes: [event], blobs: [event, subject], doubles:
 * [value] }`. Fire-and-forget (the runtime sends it in the background), and a no-op where no
 * binding is configured (a local run without one), so metrics never fail a request.
 */
export function writeMetric(
  env: MetricsEnv,
  event: MetricEvent,
  subject: string,
  value: number,
): void {
  if (typeof env.METRICS?.writeDataPoint !== 'function') return;
  env.METRICS.writeDataPoint({ indexes: [event], blobs: [event, subject], doubles: [value] });
}

/**
 * Runs one areas request's database work and writes its time in ms as a `DB_QUERY` datapoint,
 * failed runs included. Workers' clock advances across I/O, so the value is the wait on Postgres.
 */
export async function timedQuery<T>(env: MetricsEnv, op: DbOp, run: () => Promise<T>): Promise<T> {
  const started = Date.now();
  try {
    return await run();
  } finally {
    writeMetric(env, TELEMETRY.EVENTS.DB_QUERY, op, Date.now() - started);
  }
}

/**
 * Counts a Room's client frames and hands the count to `flush` once per
 * `TELEMETRY.MESSAGES_FLUSH_MS` window: the first frame after a flush arms a timer, an idle Room
 * arms none. A pending timer keeps the Room from hibernating until it fires, so no count is lost
 * to hibernation; an eviction (deploy, crash) drops at most one window.
 */
export class MessageBatch {
  private pending = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly flush: (count: number) => void) {}

  add(): void {
    this.pending++;
    this.timer ??= setTimeout(() => {
      this.timer = undefined;
      this.flush(this.pending);
      this.pending = 0;
    }, TELEMETRY.MESSAGES_FLUSH_MS);
  }
}
