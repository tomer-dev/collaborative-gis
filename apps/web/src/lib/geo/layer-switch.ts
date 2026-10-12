import { GOVMAP, MAP } from '@cgis/shared';
// Default import, as in govmap-crs.ts: the Leaflet object plugins attach to.
import L from 'leaflet';

declare module 'leaflet' {
  interface ZoomOptions {
    /** `setView`: jump without animation and fire `viewreset` (Leaflet documents it; @types omits it). */
    reset?: boolean | undefined;
  }
}

/** The base layers: OpenStreetMap on Web Mercator, govmap's aerial imagery on EPSG:2039. */
export type BaseLayerId = 'osm' | 'aerial';

/** Class of the still copy of the old base layer that the new one fades in over. */
export const SNAPSHOT_CLASS = 'cgis-base-snapshot';

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

type BaseLayer = { crs: L.CRS; layer: L.GridLayer };

/** A new layer per switch, with its CRS. */
const BASE_LAYERS: Record<BaseLayerId, () => Promise<BaseLayer>> = {
  osm: async () => ({
    crs: L.CRS.EPSG3857,
    layer: L.tileLayer(MAP.OSM_TILE_URL, {
      attribution: MAP.OSM_ATTRIBUTION,
      maxZoom: MAP.OSM_MAX_ZOOM,
    }),
  }),
  // Loaded on the first switch to aerial: proj4 and Proj4Leaflet are about 47 kB gzip (ADR-0005).
  aerial: async () => {
    const [{ govmapCrs }, { createGovmapLayer }] = await Promise.all([
      import('./govmap-crs'),
      import('./govmap-layer'),
    ]);
    return { crs: govmapCrs, layer: createGovmapLayer() };
  },
};

/** The base layer the map shows, told by its CRS: the aerial layer is the only one that swaps it. */
export function currentBaseLayer(map: L.Map): BaseLayerId {
  return map.options.crs === L.CRS.EPSG3857 ? 'osm' : 'aerial';
}

/**
 * Ground metres per pixel at each zoom of `base` (index = zoom) at latitude `lat`, in degrees.
 * govmap's table is in EPSG:2039 grid metres, within about 0.01 % of ground metres over Israel.
 */
export function zoomResolutions(base: BaseLayerId, lat: number): readonly number[] {
  if (base === 'aerial') return GOVMAP.RESOLUTIONS;
  const atLat = MAP.OSM_Z0_METRES_PER_PIXEL * Math.cos((lat * Math.PI) / 180);
  return Array.from({ length: MAP.OSM_MAX_ZOOM + 1 }, (_, zoom) => atLat / 2 ** zoom);
}

/**
 * The zoom on `to` whose resolution at latitude `lat` is nearest to that of `zoom` on `from`,
 * compared as ratios: the levels step ×2 on OSM and ×2 to ×3 on govmap, so 2.02 m/px is nearer
 * 2.65 (×1.31) than 1.32 (×1.53). Throws a RangeError for a zoom `from` does not have.
 */
export function mapZoom(zoom: number, from: BaseLayerId, to: BaseLayerId, lat: number): number {
  const metresPerPixel = zoomResolutions(from, lat)[Math.round(zoom)];
  if (metresPerPixel === undefined) throw new RangeError(`${from} has no zoom ${zoom}`);
  let nearest = { zoom: 0, off: Infinity };
  zoomResolutions(to, lat).forEach((resolution, candidate) => {
    const off = Math.abs(Math.log(resolution / metresPerPixel));
    if (off < nearest.off) nearest = { zoom: candidate, off };
  });
  return nearest.zoom;
}

/**
 * Shows `target` as the base layer, swapping the map's CRS (Leaflet has no `setCRS`; D3 option A):
 * reads the centre and zoom, removes the base layer, sets `map.options.crs`, resets the view at the
 * nearest-resolution zoom and adds the new base layer. The reset fires `viewreset`, on which Leaflet
 * projects every overlay again from its WGS 84 LatLngs through the new CRS: the saved areas, the
 * ghosts and the draw tool's sketch (paths) and its handles (markers), so a draft in progress
 * stays. The new layer fades in over a still copy of the old one for `MAP.CROSSFADE_MS`, except
 * under prefers-reduced-motion.
 *
 * The first switch to aerial waits for its modules; everything after that wait runs in one task,
 * so the map is never painted half switched. Resolves without a change when `signal` aborted during
 * the wait or the map already shows `target`.
 */
export async function switchBaseLayer(
  map: L.Map,
  target: BaseLayerId,
  signal?: AbortSignal,
): Promise<void> {
  if (currentBaseLayer(map) === target) return;
  const next = await BASE_LAYERS[target]();
  const from = currentBaseLayer(map);
  if (signal?.aborted || from === target) return;

  const center = map.getCenter();
  const zoom = mapZoom(map.getZoom(), from, target, center.lat);
  const old = baseLayers(map);
  const { tilePane } = map.getPanes();
  // An unfinished copy from the previous switch goes first.
  for (const stale of tilePane.querySelectorAll(`.${SNAPSHOT_CLASS}`)) stale.remove();
  const snapshot = window.matchMedia(REDUCED_MOTION).matches ? null : snapshotOf(map, old);

  for (const layer of old) layer.remove();
  map.options.crs = next.crs;
  map.setView(center, zoom, { reset: true });
  next.layer.addTo(map);

  if (snapshot) crossfade(map, snapshot, next.layer);
}

/** The map's tile layers: every one of them is a base layer (overlays are paths). */
function baseLayers(map: L.Map): L.GridLayer[] {
  const layers: L.GridLayer[] = [];
  map.eachLayer((layer) => {
    if (layer instanceof L.GridLayer) layers.push(layer);
  });
  return layers;
}

/**
 * A still copy of the base layers' tiles. It is placed after the view reset, which moves the map
 * pane back to 0,0, so it carries the map pane's current offset to stay where the tiles are now.
 */
function snapshotOf(map: L.Map, layers: readonly L.GridLayer[]): HTMLElement {
  const { mapPane } = map.getPanes();
  const snapshot = L.DomUtil.create('div', `leaflet-layer ${SNAPSHOT_CLASS}`);
  L.DomUtil.setPosition(snapshot, L.DomUtil.getPosition(mapPane));
  for (const layer of layers) {
    const tiles = layer.getContainer();
    if (tiles) snapshot.append(tiles.cloneNode(true));
  }
  return snapshot;
}

/**
 * Puts the copy of the old tiles under the new layer (first in the tile pane) and fades the new
 * layer in over it; the copy goes when the fade ends. Fading only the top layer keeps the picture
 * opaque throughout (fading both would let the background through halfway).
 */
function crossfade(map: L.Map, snapshot: HTMLElement, next: L.GridLayer): void {
  map.getPanes().tilePane.prepend(snapshot);
  const remove = () => snapshot.remove();
  const fade = next.getContainer()?.animate([{ opacity: 0 }, { opacity: 1 }], MAP.CROSSFADE_MS);
  if (fade) fade.finished.then(remove, remove);
  else remove();
}
