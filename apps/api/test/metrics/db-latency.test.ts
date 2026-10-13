import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../src/app';
import {
  areasClient,
  areasEnv,
  bboxAround,
  freshUser,
  randomSpot,
  squareAt,
} from '../areas/fixtures';

// Wire values (event names, blob order) are spelled out: they are what the dashboard query reads.

let env: Env;
beforeAll(async () => {
  env = await areasEnv();
});

/** `env` with a stand-in METRICS binding, and the datapoints it received with `blob1 = db_query`. */
function withDataset() {
  const writeDataPoint = vi.fn<(point: AnalyticsEngineDataPoint) => void>();
  const queries = () =>
    writeDataPoint.mock.calls.map(([point]) => point).filter((p) => p.blobs?.[0] === 'db_query');
  return { bindings: { ...env, METRICS: { writeDataPoint } }, queries };
}

describe('db_query datapoints on the areas paths', () => {
  it('a write and a bounds read each write one datapoint with their ms', async () => {
    const { bindings, queries } = withDataset();
    const api = areasClient(bindings, freshUser());
    const spot = randomSpot();
    expect((await api.create({ name: 'timed', geometry: squareAt(spot) })).status).toBe(201);
    expect((await api.list(`bbox=${bboxAround(spot)}`)).status).toBe(200);
    expect(queries().map((p) => p.blobs)).toEqual([
      ['db_query', 'areas.write'],
      ['db_query', 'areas.list'],
    ]);
    for (const point of queries()) {
      expect(point.indexes).toEqual(['db_query']);
      expect(point.doubles?.[0]).toBeGreaterThanOrEqual(0);
    }
  });
});
