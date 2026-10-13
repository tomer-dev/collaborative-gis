// The stack the e2e run starts (playwright.config.ts) and prepares (global-setup.ts).
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { COPY, DEV, ROUTES } from '@cgis/shared/constants';
import type { Page } from '@playwright/test';

export const STACK = {
  /** Lane database on the compose PostGIS (scripts/db-lane.sh), emptied and migrated per run. */
  DB_LANE: 'cgis_e2e',
  /** The e2e Worker's Durable Object state, relative to apps/api: apart from `pnpm dev`'s. */
  WRANGLER_STATE: '.wrangler/e2e',
  /** The Worker's port when DEV.API_ORIGIN's is taken; Vite's proxy follows (vite.config.ts). */
  API_PORT_ENV: 'E2E_API_PORT',
  /** Vite's port when DEV.WEB_ORIGIN's is taken; the Worker's CLIENT_ORIGIN follows it. */
  WEB_PORT_ENV: 'E2E_WEB_PORT',
  /** Starting `wrangler dev` or Vite. */
  SERVER_START_MS: 120_000,
  /** Sign-up and the first /map load (Vite compiles the app on its first request). */
  PAGE_MS: 30_000,
  /** The whole scenario (a cold Vite compiles the app on the first /map load). */
  TEST_MS: 120_000,
} as const;

export const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

/** `origin` on the port the environment variable `portEnv` names, when it is set. */
function withPortFrom(origin: string, portEnv: string): string {
  const url = new URL(origin);
  url.port = process.env[portEnv] ?? url.port;
  return url.origin;
}

/** The Worker's origin for this run: DEV.API_ORIGIN, or its host on `E2E_API_PORT`. */
export const apiOrigin = () => withPortFrom(DEV.API_ORIGIN, STACK.API_PORT_ENV);

/** The SPA's origin for this run: DEV.WEB_ORIGIN, or its host on `E2E_WEB_PORT`. */
export const webOrigin = () => withPortFrom(DEV.WEB_ORIGIN, STACK.WEB_PORT_ENV);

/** URL of the e2e lane database, created (once) with PostGIS by scripts/db-lane.sh. */
export function laneDatabaseUrl(): string {
  try {
    return execFileSync('bash', ['scripts/db-lane.sh', STACK.DB_LANE], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    }).trim();
  } catch (cause) {
    throw new Error(
      `e2e: could not create the ${STACK.DB_LANE} lane database. Is the compose PostGIS up (pnpm db:up)?`,
      { cause },
    );
  }
}

/** Signs a new user up through the register form (a random password); the app then opens /map. */
export async function register(page: Page, name: string, email: string): Promise<void> {
  await page.goto(ROUTES.APP.REGISTER);
  const field = (label: string) => page.getByRole('textbox', { name: label, exact: true });
  await field(COPY.AUTH.NAME_LABEL).fill(name);
  await field(COPY.AUTH.EMAIL_LABEL).fill(email);
  await field(COPY.AUTH.PASSWORD_LABEL).fill(randomUUID());
  await page.getByRole('button', { name: COPY.AUTH.REGISTER_SUBMIT }).click();
  await page.waitForURL(ROUTES.APP.MAP, { timeout: STACK.PAGE_MS });
}
