import { builtinModules } from 'node:module';
import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: './wrangler.jsonc' } })],
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
