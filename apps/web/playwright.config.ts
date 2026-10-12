// Two-browser end-to-end run (`pnpm e2e` at the repo root). Playwright starts the stack itself:
// `wrangler dev` against the e2e lane database, and Vite, whose proxy forwards /api and /ws to it.
// e2e/collaboration.spec.ts lists the environment variables.
import { randomBytes } from 'node:crypto';
import { ROUTES } from '@cgis/shared/constants';
import { defineConfig, devices } from '@playwright/test';
import { apiOrigin, laneDatabaseUrl, REPO_ROOT, STACK, webOrigin } from './e2e/stack';

const api = apiOrigin();
const web = webOrigin();

export default defineConfig({
  testDir: 'e2e',
  // Ignored by git, ESLint and Prettier; a failure leaves its trace here.
  outputDir: 'node_modules/.e2e-results',
  globalSetup: './e2e/global-setup.ts',
  timeout: STACK.TEST_MS,
  workers: 1,
  forbidOnly: !!process.env.CI,
  reporter: 'list',
  use: { baseURL: web, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // Never reused: the run owns its servers, so they use the e2e database and this run's origins.
  webServer: [
    {
      name: 'api',
      command: [
        `pnpm --filter @cgis/api dev --port ${new URL(api).port}`,
        `--persist-to ${STACK.WRANGLER_STATE} --var CLIENT_ORIGIN:${web}`,
      ].join(' '),
      cwd: REPO_ROOT,
      url: `${api}${ROUTES.HEALTHZ}`,
      reuseExistingServer: false,
      timeout: STACK.SERVER_START_MS,
      env: {
        CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE: laneDatabaseUrl(),
        // Used only when apps/api/.dev.vars does not exist (wrangler then reads process.env).
        BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? randomBytes(32).toString('base64'),
        BETTER_AUTH_URL: process.env.BETTER_AUTH_URL ?? api,
      },
    },
    {
      name: 'web',
      command: `pnpm --filter @cgis/web dev --config e2e/vite.config.ts --port ${new URL(web).port} --strictPort`,
      cwd: REPO_ROOT,
      url: web,
      reuseExistingServer: false,
      timeout: STACK.SERVER_START_MS,
    },
  ],
});
