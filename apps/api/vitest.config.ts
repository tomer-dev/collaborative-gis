import { builtinModules } from 'node:module';
import { DEV } from '@cgis/shared/constants';
import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

// Test-only values for wrangler.jsonc `secrets.required`; wrangler reads them from process.env.
process.env.BETTER_AUTH_SECRET ??= 'test-only-better-auth-secret-0123456789abcdef';
process.env.BETTER_AUTH_URL ??= DEV.API_ORIGIN;

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
    }),
  ],
  test: {
    include: ['test/**/*.test.ts'],
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
});
