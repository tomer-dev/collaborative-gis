/**
 * The base-layer switch in a real browser: swapping OSM (Web Mercator) for govmap's aerial imagery
 * (EPSG:2039) keeps the view's centre and the saved polygons where they were, and keeps a draft in
 * progress.
 *
 * Run: `pnpm e2e` at the repo root (apps/web/e2e/README.md); the environment variables are those of
 * collaboration.spec.ts. The aerial tiles come from govmap's CDN, so the run needs the internet.
 *
 * The app keeps its Leaflet map private. Leaflet's UMD build always sets `window.L`, so an init
 * script intercepts that write and registers a map init hook: `window.cgisMaps` lists every map the
 * page creates, the live one last (StrictMode creates and removes one first in dev).
 */
import { randomUUID } from 'node:crypto';
import { COPY, DRAW, GOVMAP, MAP, ROUTES, type AreaCreate } from '@cgis/shared';
import { expect, test, type Page } from '@playwright/test';
import type * as Leaflet from 'leaflet';

declare global {
  interface Window {
    /** Every Leaflet map the page created (trackMaps). */
    cgisMaps?: Leaflet.Map[];
  }
}

const WAIT = {
  /** Sign-up and the first /map load (Vite compiles the app on its first request). */
  PAGE_MS: 30_000,
  /** The aerial modules' first load and govmap's first tiles. */
  SWITCH_MS: 15_000,
} as const;

/** The most a projected point may sit off where it should be, in CSS px. */
const TOLERANCE = { CENTRE_PX: 1, POLYGON_PX: 2 } as const;

/** OSM way 1019049226, the Dizengoff fountain: the spike's alignment point (research §2.3, §5). */
const FOUNTAIN = { lat: 32.0779953, lng: 34.7741951 };
/** The Western Wall plaza, H8's second tile fixture: away from the saved polygon. */
const WESTERN_WALL = { lat: 31.7767, lng: 35.2345 };

/**
 * OSM z11 and govmap L03 are 64.77 and 66.15 m/px at the fountain: the one pair of levels this
 * close (2 %), so a saved polygon's screen box can be compared unscaled across the switch.
 */
const VIEW = { OSM_ZOOM: 11, AERIAL_LEVEL: 3, STREET_ZOOM: 17, STREET_LEVEL: 8 } as const;

/** A 0.02° square on the fountain: about 29 × 34 px at z11, so its edges sit near the centre. */
const HALF_SIDE_DEG = 0.01;
const SQUARE: AreaCreate = {
  name: 'e2e layer switch',
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [FOUNTAIN.lng - HALF_SIDE_DEG, FOUNTAIN.lat - HALF_SIDE_DEG],
        [FOUNTAIN.lng + HALF_SIDE_DEG, FOUNTAIN.lat - HALF_SIDE_DEG],
        [FOUNTAIN.lng + HALF_SIDE_DEG, FOUNTAIN.lat + HALF_SIDE_DEG],
        [FOUNTAIN.lng - HALF_SIDE_DEG, FOUNTAIN.lat + HALF_SIDE_DEG],
        [FOUNTAIN.lng - HALF_SIDE_DEG, FOUNTAIN.lat - HALF_SIDE_DEG],
      ],
    ],
  },
};

/** MapView's container label (a literal in components/Map.tsx; there is no constant for it). */
const MAP_REGION = 'Map';

/** Draft vertices, in px from the map's centre. */
const DRAFT = [
  [-60, -40],
  [60, -40],
  [0, 60],
] as const;

type LatLng = { lat: number; lng: number };
type Box = { left: number; top: number; right: number; bottom: number };
type Point = { x: number; y: number };

/** What the live map shows, in px relative to the map container. */
type View = {
  crs: string;
  zoom: number;
  centre: LatLng;
  /** Container px between `probe` and the container's centre (Leaflet rounds to whole px). */
  probeOffCentre: number;
  /** Ground metres per CSS px across the middle of the map. */
  metresPerPixel: number;
  /** The first saved polygon's screen box, if one is drawn. */
  area: Box | null;
  /** The draw tool's handle centres. */
  handles: Point[];
};

/** Before any app script: list every Leaflet map the page creates on `window.cgisMaps`. */
function trackMaps() {
  const maps: Leaflet.Map[] = [];
  window.cgisMaps = maps;
  let leaflet: typeof Leaflet | undefined;
  Object.defineProperty(window, 'L', {
    configurable: true,
    get: () => leaflet,
    set(value: typeof Leaflet) {
      leaflet = value;
      value.Map.addInitHook(function (this: Leaflet.Map) {
        maps.push(this);
      });
    },
  });
}

async function signUp(page: Page): Promise<void> {
  await page.addInitScript(trackMaps);
  const label = randomUUID();
  await page.goto(ROUTES.APP.REGISTER);
  await page.getByRole('textbox', { name: COPY.AUTH.NAME_LABEL, exact: true }).fill(`E2E ${label}`);
  await page
    .getByRole('textbox', { name: COPY.AUTH.EMAIL_LABEL, exact: true })
    .fill(`e2e-layers-${label}@example.com`);
  await page
    .getByRole('textbox', { name: COPY.AUTH.PASSWORD_LABEL, exact: true })
    .fill(randomUUID());
  await page.getByRole('button', { name: COPY.AUTH.REGISTER_SUBMIT }).click();
  await expect(page).toHaveURL(ROUTES.APP.MAP, { timeout: WAIT.PAGE_MS });
  await expect.poll(() => page.evaluate(() => window.cgisMaps?.length ?? 0)).toBeGreaterThan(0);
}

/** Moves the live map, without animation. */
async function setView(page: Page, centre: LatLng, zoom: number): Promise<void> {
  await page.evaluate(
    ({ centre, zoom }) => {
      window.cgisMaps?.at(-1)?.setView(centre, zoom, { animate: false });
    },
    { centre, zoom },
  );
}

/** Reads the live map; `probe` defaults to the map's own centre. */
async function measure(page: Page, probe?: LatLng): Promise<View> {
  return page.evaluate(
    ({ probe, areasPane }) => {
      const map = window.cgisMaps?.at(-1);
      if (!map) throw new Error('no Leaflet map on the page');
      const origin = map.getContainer().getBoundingClientRect();
      const size = map.getSize();
      const centre = map.getCenter();
      const point = map.latLngToContainerPoint(probe ?? centre);
      const west = map.containerPointToLatLng([0, size.y / 2]);
      const east = map.containerPointToLatLng([size.x, size.y / 2]);
      const rect = document
        .querySelector(`.leaflet-${areasPane}-pane path`)
        ?.getBoundingClientRect();
      const handles = Array.from(document.querySelectorAll('.cgis-draw-handle'), (handle) => {
        const box = handle.getBoundingClientRect();
        return { x: box.x + box.width / 2 - origin.x, y: box.y + box.height / 2 - origin.y };
      });
      return {
        crs: map.options.crs?.code ?? '',
        zoom: map.getZoom(),
        centre: { lat: centre.lat, lng: centre.lng },
        probeOffCentre: Math.hypot(point.x - size.x / 2, point.y - size.y / 2),
        metresPerPixel: map.distance(west, east) / size.x,
        area: rect
          ? {
              left: rect.left - origin.x,
              top: rect.top - origin.y,
              right: rect.right - origin.x,
              bottom: rect.bottom - origin.y,
            }
          : null,
        handles,
      };
    },
    { probe, areasPane: MAP.AREAS_PANE },
  );
}

/** Clicks a base-layer toggle and waits until the map shows that CRS and every fade has ended. */
async function switchTo(page: Page, label: string, crs: (code: string) => boolean): Promise<void> {
  await page.getByRole('button', { name: label }).click();
  await expect(page.getByRole('button', { name: label })).toHaveAttribute('aria-pressed', 'true');
  await expect
    .poll(async () => crs((await measure(page)).crs), { timeout: WAIT.SWITCH_MS })
    .toBe(true);
  // The crossfade has ended (a Web Animation; Leaflet fades its tiles in from script, in place).
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document
            .getAnimations()
            .filter(
              ({ effect }) =>
                effect instanceof KeyframeEffect && effect.target?.closest('.leaflet-tile-pane'),
            ).length,
      ),
    )
    .toBe(0);
}
const isAerial = (code: string) => code === GOVMAP.EPSG;
const isOsm = (code: string) => code !== GOVMAP.EPSG;

/** Largest edge movement between two boxes, in px. */
const moved = (a: Box, b: Box) =>
  Math.max(
    Math.abs(a.left - b.left),
    Math.abs(a.top - b.top),
    Math.abs(a.right - b.right),
    Math.abs(a.bottom - b.bottom),
  );

test('switching to aerial keeps the centre and the saved polygon in place', async ({ page }) => {
  await signUp(page);

  await test.step('a saved polygon on the fountain, viewed at OSM z11', async () => {
    const status = await page.evaluate(
      async ({ url, body }) =>
        (
          await fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          })
        ).status,
      { url: ROUTES.AREAS, body: SQUARE },
    );
    expect(status).toBe(201);
    await setView(page, FOUNTAIN, VIEW.OSM_ZOOM);
    await expect(page.locator(`.leaflet-${MAP.AREAS_PANE}-pane path`)).toHaveCount(1);
  });

  const before = await measure(page);
  expect(before.area).not.toBeNull();

  await test.step('aerial: centre within 1 px, polygon box moved < 2 px', async () => {
    await switchTo(page, COPY.MAP.AERIAL_LABEL, isAerial);
    await expect(
      page.locator(`img.leaflet-tile-loaded[src^="${GOVMAP.TILE_HOST}/"]`).first(),
    ).toBeVisible({ timeout: WAIT.SWITCH_MS });

    const after = await measure(page, before.centre);
    expect(after.zoom).toBe(VIEW.AERIAL_LEVEL);
    expect(after.probeOffCentre).toBeLessThan(TOLERANCE.CENTRE_PX);
    const shift = before.area && after.area ? moved(before.area, after.area) : Infinity;
    // Leaflet rounds each vertex and the pixel origin to whole px: up to 1 px per view.
    console.log(
      `fountain z${VIEW.OSM_ZOOM} → L${VIEW.AERIAL_LEVEL}: centre ${after.probeOffCentre.toFixed(3)} px off,` +
        ` polygon box moved ${shift.toFixed(3)} px`,
    );
    expect(shift).toBeLessThan(TOLERANCE.POLYGON_PX);
  });

  await test.step('and back to OSM: the same zoom, centre and box', async () => {
    await switchTo(page, COPY.MAP.OSM_LABEL, isOsm);
    const back = await measure(page, before.centre);
    expect(back.zoom).toBe(VIEW.OSM_ZOOM);
    expect(back.probeOffCentre).toBeLessThan(TOLERANCE.CENTRE_PX);
    expect(back.area && before.area && moved(before.area, back.area)).toBeLessThan(
      TOLERANCE.POLYGON_PX,
    );
  });
});

test('a draft in progress survives the switch at street level', async ({ page }) => {
  await signUp(page);
  await setView(page, WESTERN_WALL, VIEW.STREET_ZOOM);

  const map = page.getByRole('region', { name: MAP_REGION, exact: true });
  const box = await map.boundingBox();
  if (!box) throw new Error('the map has no layout box');
  await page.getByRole('button', { name: DRAW.START_LABEL }).click();
  for (const [dx, dy] of DRAFT) {
    await page.mouse.click(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy);
  }
  const before = await measure(page);
  expect(before.handles).toHaveLength(DRAFT.length);

  await switchTo(page, COPY.MAP.AERIAL_LABEL, isAerial);
  const after = await measure(page, before.centre);
  expect(after.zoom).toBe(VIEW.STREET_LEVEL);
  expect(after.probeOffCentre).toBeLessThan(TOLERANCE.CENTRE_PX);

  // L08 is coarser than z17: the handles close in on the centre by the ratio of the resolutions.
  const scale = before.metresPerPixel / after.metresPerPixel;
  const centre = { x: box.width / 2, y: box.height / 2 };
  expect(after.handles).toHaveLength(DRAFT.length);
  const errors = after.handles.map((handle, index) => {
    const was = before.handles[index];
    if (!was) throw new Error(`no handle ${index} before the switch`);
    const expected = {
      x: centre.x + (was.x - centre.x) * scale,
      y: centre.y + (was.y - centre.y) * scale,
    };
    return Math.hypot(handle.x - expected.x, handle.y - expected.y);
  });
  console.log(
    `western wall z${VIEW.STREET_ZOOM} → L${VIEW.STREET_LEVEL}: scale ${scale.toFixed(4)},` +
      ` draft handles at most ${Math.max(...errors).toFixed(3)} px off`,
  );
  for (const error of errors) expect(error).toBeLessThan(TOLERANCE.POLYGON_PX);

  // The sketch still finishes, on the aerial layer.
  await page.getByRole('button', { name: DRAW.FINISH_LABEL }).click();
  await expect(page.getByRole('dialog', { name: COPY.AREAS.SAVE_TITLE })).toBeVisible();
});
