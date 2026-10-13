import { env } from 'cloudflare:workers';
import { inject } from 'vitest';
import type { Env } from '../../src/app';

/**
 * The test env with `HYPERDRIVE` pointed at the lane database for `base`: `<base>_<lane>`
 * (test/lane.ts), created, emptied and migrated for this run by test/lane-setup.ts. Pass it to
 * `createApp().request(path, init, laneEnv)` and to `readSession`.
 */
export async function laneEnv(base: string): Promise<Env> {
  const url = inject('laneUrls')[base];
  if (!url) throw new Error(`no lane database for ${base}: list it in test/lane-setup.ts`);
  return { ...env, HYPERDRIVE: { connectionString: url } as Hyperdrive };
}
