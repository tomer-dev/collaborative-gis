import { TELEMETRY } from '@cgis/shared';
import { describe, expect, it, vi } from 'vitest';
import { timedQuery, writeMetric } from '../../src/metrics';

// Wire values (event names, blob order) are spelled out: they are what the dashboard query reads.

/** A stand-in `METRICS` binding that records its datapoints. */
const dataset = () => ({ writeDataPoint: vi.fn<(point: AnalyticsEngineDataPoint) => void>() });

describe('writeMetric', () => {
  it('writes { indexes: [event], blobs: [event, subject], doubles: [value] }', () => {
    const METRICS = dataset();
    writeMetric({ METRICS }, TELEMETRY.EVENTS.WS_OPEN, 'default', 1);
    expect(METRICS.writeDataPoint).toHaveBeenCalledExactlyOnceWith({
      indexes: ['ws_open'],
      blobs: ['ws_open', 'default'],
      doubles: [1],
    });
  });

  it('is a no-op without a binding (local dev without one), not a crash', () => {
    expect(() => writeMetric({}, TELEMETRY.EVENTS.WS_OPEN, 'default', 1)).not.toThrow();
  });

  it('the real binding of the test environment takes a datapoint', async () => {
    const { env } = await import('cloudflare:workers');
    expect(() => writeMetric(env, TELEMETRY.EVENTS.WS_CLOSE, 'default', 1)).not.toThrow();
  });
});

describe('timedQuery', () => {
  it('returns the result and writes one db_query datapoint with the elapsed ms', async () => {
    const METRICS = dataset();
    expect(await timedQuery({ METRICS }, TELEMETRY.DB_OPS.LIST, async () => 'rows')).toBe('rows');
    const point = METRICS.writeDataPoint.mock.calls[0]?.[0];
    expect(point).toMatchObject({ indexes: ['db_query'], blobs: ['db_query', 'areas.list'] });
    expect(point?.doubles?.[0]).toBeGreaterThanOrEqual(0);
  });

  it('a failed query still writes its datapoint and rethrows', async () => {
    const METRICS = dataset();
    const failing = timedQuery({ METRICS }, TELEMETRY.DB_OPS.WRITE, async () => {
      throw new Error('boom');
    });
    await expect(failing).rejects.toThrow('boom');
    expect(METRICS.writeDataPoint).toHaveBeenCalledOnce();
  });
});

describe('wrangler.jsonc', () => {
  it('binds METRICS to TELEMETRY.DATASET in every env', () => {
    const [config] = Object.values(
      import.meta.glob<string>('../../wrangler.jsonc', {
        query: '?raw',
        import: 'default',
        eager: true,
      }),
    );
    const datasets = [...(config ?? '').matchAll(/"analytics_engine_datasets":\s*(\[[^\]]*\])/g)];
    expect(datasets.map(([, json]) => JSON.parse(json ?? ''))).toEqual([
      [{ binding: 'METRICS', dataset: TELEMETRY.DATASET }],
      [{ binding: 'METRICS', dataset: TELEMETRY.DATASET }],
    ]);
  });
});
