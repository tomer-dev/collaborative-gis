import { execFileSync } from 'node:child_process';
import { builtinModules } from 'node:module';
import { DEV } from '@cgis/shared/constants';
import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { configDefaults, defineConfig } from 'vitest/config';
import { LANE_ENV, sanitizeLane } from './test/lane.ts';

// Test-only values for wrangler.jsonc `secrets.required`; wrangler reads them from process.env.
process.env.BETTER_AUTH_SECRET ??= 'test-only-better-auth-secret-0123456789abcdef';
process.env.BETTER_AUTH_URL ??= DEV.API_ORIGIN;

/** The current git branch, or '' outside a checkout (then the databases keep their base names). */
function gitBranch(): string {
  try {
    return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

// The lane names this run's databases (test/lane.ts). db/global-setup.ts reads it from the env;
// workerd tests get it through `inject('testLane')`.
const testLane = sanitizeLane(process.env[LANE_ENV] ?? gitBranch());
process.env[LANE_ENV] = testLane;

export default defineConfig({
  test: {
    projects: [
      {
        plugins: [
          cloudflareTest({
            wrangler: { configPath: './wrangler.jsonc' },
          }),
        ],
        test: {
          name: 'workers',
          provide: { testLane },
          include: ['test/**/*.test.ts'],
          // test/db runs in Node (its own project below).
          exclude: [...configDefaults.exclude, 'test/db/**'],
          // Pre-bundle pg: the workerd runner can't load pg-protocol's mislabelled ESM build.
          deps: {
            optimizer: {
              ssr: {
                enabled: true,
                include: ['pg'],
                rolldownOptions: { external: [...builtinModules, /^node:/] },
              },
            },
          },
        },
      },
      './test/db/vitest.config.ts',
    ],
  },
});
