/**
 * Two users on one map, in two browser contexts: the product brief's collaboration requirements
 * end to end (presence, live drafts, live saves, the version conflict, leaving).
 *
 * Run: `pnpm e2e` at the repo root (apps/web/e2e/README.md). playwright.config.ts starts
 * `wrangler dev` and Vite; global-setup.ts empties and migrates the database first.
 *
 * Environment, following apps/api/.dev.vars.example:
 * - BETTER_AUTH_SECRET, BETTER_AUTH_URL: the Worker's required secrets. Read from apps/api/.dev.vars
 *   when that file exists; otherwise from the environment, where the config defaults them to a
 *   random per-run secret and the Worker's origin.
 * - CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE: always set by the config to the
 *   `cgis_e2e` lane database (scripts/db-lane.sh on the compose PostGIS; start it with `pnpm db:up`).
 * - E2E_API_PORT (optional): the Worker's port when 8787 is taken; Vite's proxy follows.
 * - E2E_WEB_PORT (optional): Vite's port when 5173 is taken; the Worker's CLIENT_ORIGIN follows.
 */
import { randomUUID } from 'node:crypto';
import { CACHE, COPY, DRAW, MAP, ROUTES } from '@cgis/shared';
import { expect, test, type Browser, type Page, type Response } from '@playwright/test';

/** Every wait in the scenario. */
const WAIT = {
  /** The product brief: a polygon one user saves shows up for the others within 2 s. */
  SAVED_AREA_MS: 2000,
  /** Presence and draft relays over the room WebSocket. */
  REALTIME_MS: 10_000,
  /** Sign-up and the first /map load (Vite compiles the app on its first request). */
  PAGE_MS: 30_000,
} as const;

/** Clicked vertices, in px from the map's centre: the bounding box's centre lies inside. */
const TRIANGLE = [
  [-100, -80],
  [100, -80],
  [0, 100],
] as const;

/** Leaflet's SVG path data for a closed ring of the triangle's vertex count (`M x yL x y…z`). */
const TRIANGLE_PATH = new RegExp(`^M[^MLz]+(?:L[^MLz]+){${TRIANGLE.length - 1}}z$`);

const AREA = {
  NAME: 'e2e-area',
  A_RENAME: 'e2e-area renamed by A',
  B_RENAME: 'e2e-area renamed by B',
} as const;

/** MapView's container label (a literal in components/Map.tsx; there is no constant for it). */
const MAP_REGION = 'Map';

const RUN = Date.now();

/** `GET /api/areas?bbox=…`: a viewport read (not a request for one area). */
const isAreasRead = (response: Response) =>
  response.request().method() === 'GET' && new URL(response.url()).pathname === ROUTES.AREAS;

/** `firstRead`: the map's first viewport read, answered. */
type User = { name: string; page: Page; firstRead: Response };

/** Signs a new user up in a fresh browser context; the app then opens /map. */
async function signUp(browser: Browser, label: string): Promise<User> {
  const page = await (await browser.newContext()).newPage();
  const firstRead = page.waitForResponse(isAreasRead, { timeout: WAIT.PAGE_MS });
  const name = `E2E ${label} ${RUN}`;
  await page.goto(ROUTES.APP.REGISTER);
  await page.getByRole('textbox', { name: COPY.AUTH.NAME_LABEL, exact: true }).fill(name);
  await page
    .getByRole('textbox', { name: COPY.AUTH.EMAIL_LABEL, exact: true })
    .fill(`e2e-${label}-${RUN}@example.com`);
  await page
    .getByRole('textbox', { name: COPY.AUTH.PASSWORD_LABEL, exact: true })
    .fill(randomUUID());
  await page.getByRole('button', { name: COPY.AUTH.REGISTER_SUBMIT }).click();
  await expect(page).toHaveURL(ROUTES.APP.MAP, { timeout: WAIT.PAGE_MS });
  await expect(mapRegion(page)).toBeVisible({ timeout: WAIT.PAGE_MS });
  return { name, page, firstRead: await firstRead };
}

const mapRegion = (page: Page) => page.getByRole('region', { name: MAP_REGION, exact: true });

/** `user`'s row in the presence list on `page`. */
const presenceRow = (page: Page, user: User) =>
  page
    .getByRole('list', { name: COPY.PRESENCE.LABEL })
    .getByRole('listitem')
    .filter({ hasText: user.name });

// Map layers have no roles: Leaflet draws them as SVG paths in the panes MapView creates.
const draftPaths = (page: Page) => page.locator(`.leaflet-${MAP.DRAFTS_PANE}-pane path`);
const areaPaths = (page: Page) => page.locator(`.leaflet-${MAP.AREAS_PANE}-pane path`);

/** Clicks the TRIANGLE's vertices onto the map (the draw tool must be on). */
async function placeVertices(page: Page): Promise<void> {
  const box = await mapRegion(page).boundingBox();
  if (!box) throw new Error('the map has no layout box');
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  for (const [dx, dy] of TRIANGLE) await page.mouse.click(centre.x + dx, centre.y + dy);
}

/** The selected area's panel, named by its heading (the area's name). */
const panel = (page: Page, name: string) => page.getByRole('region', { name, exact: true });

/** Selects the area at the map's centre and renames it to `name` with its panel's Rename button. */
async function rename(page: Page, from: string, name: string): Promise<void> {
  await areaPaths(page).click();
  const form = panel(page, from);
  await form.getByRole('textbox', { name: COPY.AREAS.NAME_LABEL, exact: true }).fill(name);
  await form.getByRole('button', { name: COPY.AREAS.RENAME_SUBMIT }).click();
}

const isAreaUrl = (url: URL) => url.pathname.startsWith(`${ROUTES.AREAS}/`);

/** Holds every `PUT /api/areas/:id` from `page` in flight until the returned `release()`. */
async function holdAreaUpdates(page: Page): Promise<() => void> {
  let release = () => {};
  const released = new Promise<void>((resolve) => (release = resolve));
  await page.route(isAreaUrl, async (route) => {
    if (route.request().method() === 'PUT') await released;
    await route.fallback();
  });
  return release;
}

test('two users share presence, drafts, saves and a version conflict', async ({ browser }) => {
  const a = await test.step('A signs up and opens the map', () => signUp(browser, 'a'));
  const b = await test.step('B signs up and opens the map', () => signUp(browser, 'b'));

  await test.step('the map reads its viewport through the bounds cache', async () => {
    expect(a.firstRead.status()).toBe(200);
    expect([CACHE.STATUS.MISS, CACHE.STATUS.HIT]).toContain(
      a.firstRead.headers()[CACHE.STATUS_HEADER],
    );
  });

  await test.step('B sees A in the presence list', async () => {
    await expect(presenceRow(b.page, a)).toBeVisible({ timeout: WAIT.REALTIME_MS });
  });

  await test.step("A places three vertices; B sees the ghost in A's colour", async () => {
    // The colour the room assigned A, as B's presence list shows it (the avatar's --presence).
    const colour = await presenceRow(b.page, a)
      .locator('[style*="--presence"]')
      .evaluate((avatar) =>
        avatar instanceof HTMLElement ? avatar.style.getPropertyValue('--presence') : '',
      );
    expect(colour).not.toBe('');

    await a.page.getByRole('button', { name: DRAW.START_LABEL }).click();
    await placeVertices(a.page);
    await expect(draftPaths(b.page).and(b.page.locator(`[stroke="${colour}"]`))).toHaveAttribute(
      'd',
      TRIANGLE_PATH,
      { timeout: WAIT.REALTIME_MS },
    );
  });

  await test.step(`A saves "${AREA.NAME}"; B sees it within 2 s`, async () => {
    await a.page.getByRole('button', { name: DRAW.FINISH_LABEL }).click();
    const save = a.page.getByRole('dialog', { name: COPY.AREAS.SAVE_TITLE });
    await save.getByRole('textbox', { name: COPY.AREAS.NAME_LABEL, exact: true }).fill(AREA.NAME);
    await save.getByRole('button', { name: COPY.AREAS.SAVE_SUBMIT }).click();
    await expect(areaPaths(b.page)).toHaveCount(1, { timeout: WAIT.SAVED_AREA_MS });
    // The finished draft is gone from B's map.
    await expect(draftPaths(b.page)).toHaveCount(0, { timeout: WAIT.REALTIME_MS });

    const saved = a.page.getByRole('dialog', { name: COPY.AREAS.SAVED_TITLE });
    await saved.getByRole('button', { name: COPY.AREAS.DONE }).click();
    await expect(saved).toBeHidden();
  });

  await test.step('B renames with a stale version and gets the conflict dialog', async () => {
    // Both edit version 1. B's rename is held in flight until A's has landed (version 2), so
    // B's arrives second, carrying the stale version.
    const release = await holdAreaUpdates(b.page);
    const sent = b.page.waitForRequest(
      (request) => request.method() === 'PUT' && isAreaUrl(new URL(request.url())),
      { timeout: WAIT.REALTIME_MS },
    );
    await rename(b.page, AREA.NAME, AREA.B_RENAME);
    await sent;
    await rename(a.page, AREA.NAME, AREA.A_RENAME);
    await expect(panel(a.page, AREA.A_RENAME)).toBeVisible();
    release();

    const conflict = b.page.getByRole('alertdialog', { name: COPY.AREAS.CONFLICT_TITLE });
    await expect(conflict).toBeVisible();
    await expect(conflict.getByRole('button', { name: COPY.AREAS.LOAD_THEIRS })).toBeVisible();
    await expect(conflict.getByRole('button', { name: COPY.AREAS.OVERWRITE })).toBeVisible();
  });

  await test.step('B loads theirs: the panel shows A’s name', async () => {
    const conflict = b.page.getByRole('alertdialog', { name: COPY.AREAS.CONFLICT_TITLE });
    await conflict.getByRole('button', { name: COPY.AREAS.LOAD_THEIRS }).click();
    await expect(conflict).toBeHidden();
    await expect(panel(b.page, AREA.A_RENAME)).toBeVisible();
  });

  await test.step("A signs out; B's presence list drops A", async () => {
    await a.page.getByRole('button', { name: COPY.AUTH.SIGN_OUT }).click();
    await expect(a.page.getByRole('heading', { name: COPY.AUTH.LOGIN_TITLE })).toBeVisible();
    await expect(presenceRow(b.page, a)).toHaveCount(0, { timeout: WAIT.REALTIME_MS });
    await expect(presenceRow(b.page, b)).toBeVisible();
  });

  await a.page.context().close();
  await b.page.context().close();
});
