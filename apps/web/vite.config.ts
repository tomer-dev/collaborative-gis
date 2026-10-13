import { ROUTES } from '@cgis/shared/constants';
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';
import { apiOrigin } from './e2e/stack.ts';

/** `wrangler dev`: DEV.API_ORIGIN, or its host on E2E_API_PORT during an e2e run (e2e/stack.ts). */
const api = apiOrigin();

// The one Vite config: the app (dev server and build), Vitest (`test`) and Storybook, whose
// react-vite builder reads this file. https://vite.dev/config/
export default defineConfig({
  // The router plugin must run before react() so it can split route files.
  plugins: [tanstackRouter({ target: 'react', autoCodeSplitting: true }), react(), tailwindcss()],
  server: {
    // Same-origin in dev: the SPA calls /api and /ws, Vite forwards them to `wrangler dev`.
    proxy: {
      [ROUTES.API_PREFIX]: api,
      [ROUTES.WS]: { target: api.replace(/^http/, 'ws'), ws: true },
    },
  },
  // Two Vitest projects: jsdom unit tests (`test`), and every story as a
  // headless-Chromium component test (`test:storybook`; render, play, a11y at `test: 'error'`).
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'jsdom',
          include: ['src/**/*.test.{ts,tsx}'],
          setupFiles: ['src/test/jsdom-setup.ts'],
        },
      },
      {
        extends: true,
        plugins: [storybookTest({ configDir: '.storybook' })],
        test: {
          name: 'storybook',
          browser: {
            enabled: true,
            provider: playwright(),
            headless: true,
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
  },
});
