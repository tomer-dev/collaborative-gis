import { GOVMAP, MAP } from '@cgis/shared';
import L from 'leaflet';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { areaPathOptions, ghostPathOptions } from '../../ui';
import { onDraw } from './draw-events';
import { createPolygonDraw } from './draw-tool';
import { govmapCrs } from './govmap-crs';
import { GovmapTileLayer } from './govmap-layer';
import { createOsmLayer } from './osm-layer';
import {
  baseLayers,
  currentBaseLayer,
  mapZoom,
  SNAPSHOT_CLASS,
  switchBaseLayer,
  zoomResolutions,
} from './layer-switch';

/** OSM way 1019049226, the Dizengoff fountain: the spike's alignment point (research §2.3, §5). */
const FOUNTAIN = L.latLng(32.0779953, 34.7741951);
const SIZE = { width: 800, height: 600 };

it('stays out of the geo barrel with the aerial modules, which load on the first switch', async () => {
  const barrel = Object.keys(await import('./index'));
  for (const name of ['govmapCrs', 'createGovmapLayer', 'wgs84ToItm', 'switchBaseLayer']) {
    expect(barrel).not.toContain(name);
  }
});

describe('zoomResolutions', () => {
  it('is govmap’s table on aerial and Web Mercator’s ground resolution at the latitude on OSM', () => {
    expect(zoomResolutions('aerial', FOUNTAIN.lat)).toEqual(GOVMAP.RESOLUTIONS);
    expect(MAP.OSM_Z0_METRES_PER_PIXEL).toBe((2 * Math.PI * 6378137) / 256);
    const osm = zoomResolutions('osm', 60);
    expect(osm).toHaveLength(MAP.OSM_MAX_ZOOM + 1);
    expect(osm[0]).toBeCloseTo(MAP.OSM_Z0_METRES_PER_PIXEL / 2, 6); // cos 60° = ½
    expect(osm[16]).toBeCloseTo(MAP.OSM_Z0_METRES_PER_PIXEL / 2 / 2 ** 16, 9);
  });
});

describe('mapZoom: the nearest resolution, as a ratio, at the centre latitude', () => {
  // At the fountain: z16 is 2.02 m/px; L07 (2.65) is ×1.31 away, L08 (1.32) ×1.53, so L07.
  it.each([
    [0, 0],
    [8, 0],
    [9, 1],
    [10, 2],
    [11, 3],
    [12, 4],
    [13, 5],
    [14, 6],
    [15, 7],
    [16, 7],
    [17, 8],
    [18, 9],
    [19, 10],
  ])('OSM z%i at the fountain → govmap L%i', (zoom, level) => {
    expect(mapZoom(zoom, 'osm', 'aerial', FOUNTAIN.lat)).toBe(level);
  });

  // L11 (0.13 m/px) is past OSM's deepest zoom; z19 (0.25) is the nearest it serves.
  it.each([
    [0, 7],
    [1, 9],
    [2, 10],
    [3, 11],
    [4, 12],
    [5, 13],
    [6, 14],
    [7, 16],
    [8, 17],
    [9, 18],
    [10, 19],
    [11, 19],
  ])('govmap L%i at the fountain → OSM z%i', (level, zoom) => {
    expect(mapZoom(level, 'aerial', 'osm', FOUNTAIN.lat)).toBe(zoom);
  });

  it('depends on the latitude: OSM pixels shrink by cos(latitude)', () => {
    expect(mapZoom(13, 'osm', 'aerial', FOUNTAIN.lat)).toBe(5);
    expect(mapZoom(13, 'osm', 'aerial', 0)).toBe(4);
    expect(mapZoom(4, 'aerial', 'osm', 0)).toBe(13);
    expect(mapZoom(8, 'osm', 'aerial', 60)).toBe(1);
  });

  it('is the identity within one base layer', () => {
    for (let zoom = 0; zoom <= MAP.OSM_MAX_ZOOM; zoom += 1) {
      expect(mapZoom(zoom, 'osm', 'osm', FOUNTAIN.lat)).toBe(zoom);
    }
    GOVMAP.RESOLUTIONS.forEach((_, level) => {
      expect(mapZoom(level, 'aerial', 'aerial', FOUNTAIN.lat)).toBe(level);
    });
  });

  it('rejects a zoom the base layer does not have', () => {
    expect(() => mapZoom(GOVMAP.RESOLUTIONS.length, 'aerial', 'osm', FOUNTAIN.lat)).toThrow(
      RangeError,
    );
  });
});

describe('switchBaseLayer', () => {
  let container: HTMLDivElement;
  let map: L.Map;
  /** Whether the stubbed `prefers-reduced-motion: reduce` query matches. */
  let reducedMotion: boolean;

  beforeEach(() => {
    reducedMotion = true;
    vi.stubGlobal('matchMedia', (query: string) => ({ media: query, matches: reducedMotion }));
    container = document.createElement('div');
    // jsdom has no layout: Leaflet reads the map size from clientWidth/clientHeight.
    Object.defineProperty(container, 'clientWidth', { value: SIZE.width });
    Object.defineProperty(container, 'clientHeight', { value: SIZE.height });
    document.body.append(container);
    // As MapView builds it: OSM base layer, then the overlay panes.
    map = L.map(container, { center: FOUNTAIN, zoom: 16 });
    createOsmLayer().addTo(map);
    map.createPane(MAP.AREAS_PANE);
    map.createPane(MAP.DRAFTS_PANE);
  });

  afterEach(() => {
    map.remove();
    container.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const gridLayers = () => baseLayers(map);
  /** Pixels between where `latlng` is drawn and the container's centre. */
  const offCentre = (latlng: L.LatLng) =>
    map.latLngToContainerPoint(latlng).distanceTo(L.point(SIZE.width / 2, SIZE.height / 2));
  const pathData = (layer: L.Path) => layer.getElement()?.getAttribute('d');
  const triangle = [L.latLng(32.077, 34.773), L.latLng(32.077, 34.776), L.latLng(32.079, 34.7745)];

  it('starts on OSM: Leaflet’s default CRS', () => {
    expect(map.options.crs).toBe(L.CRS.EPSG3857);
    expect(currentBaseLayer(map)).toBe('osm');
  });

  it('swaps to govmap’s CRS and aerial layer at the nearest level, keeping the centre', async () => {
    await switchBaseLayer(map, 'aerial');

    expect(currentBaseLayer(map)).toBe('aerial');
    expect(map.options.crs).toBe(govmapCrs);
    const [layer, ...others] = gridLayers();
    expect(others).toEqual([]);
    expect(layer).toBeInstanceOf(GovmapTileLayer);
    expect(map.getZoom()).toBe(7); // z16 → L07 (table above)
    expect(map.getMaxZoom()).toBe(GOVMAP.RESOLUTIONS.length - 1);
    expect(offCentre(FOUNTAIN)).toBeLessThan(1);
    expect(map.attributionControl.getContainer()?.innerHTML).toContain('Survey of Israel');
  });

  it('swaps back to Web Mercator with a fresh OSM layer, keeping the centre', async () => {
    await switchBaseLayer(map, 'aerial');
    await switchBaseLayer(map, 'osm');

    expect(currentBaseLayer(map)).toBe('osm');
    expect(map.options.crs).toBe(L.CRS.EPSG3857);
    const [layer, ...others] = gridLayers();
    expect(others).toEqual([]);
    expect(layer).toBeInstanceOf(L.TileLayer);
    expect(layer).not.toBeInstanceOf(GovmapTileLayer);
    expect(map.getMaxZoom()).toBe(MAP.OSM_MAX_ZOOM);
    expect(map.getZoom()).toBe(16); // L07 → z16
    expect(offCentre(FOUNTAIN)).toBeLessThan(1);
  });

  it('leaves the map alone when it already shows the target', async () => {
    const [osm] = gridLayers();
    await switchBaseLayer(map, 'osm');
    expect(gridLayers()).toEqual([osm]);
    expect(map.getZoom()).toBe(16);
  });

  it('applies nothing when the signal aborts while the aerial modules load', async () => {
    const abort = new AbortController();
    const switching = switchBaseLayer(map, 'aerial', abort.signal);
    abort.abort();
    await switching;
    expect(currentBaseLayer(map)).toBe('osm');
    expect(gridLayers()).toHaveLength(1);
  });

  it('redraws the overlay panes through the new CRS; their LatLngs survive a round trip', async () => {
    const area = L.polygon(triangle, areaPathOptions()).addTo(map);
    const ghost = L.polygon(triangle, ghostPathOptions(MAP.PRESENCE_COLORS[0])).addTo(map);
    const before = { latLngs: area.getLatLngs(), d: pathData(area) };

    await switchBaseLayer(map, 'aerial');
    // Drawn where a polygon added under govmap's CRS is drawn, and still in its pane.
    const fresh = L.polygon(triangle, areaPathOptions()).addTo(map);
    expect(pathData(area)).toBe(pathData(fresh));
    expect(pathData(area)).not.toBe(before.d);
    expect(pathData(ghost)).toBe(pathData(fresh));
    expect(map.getPane(MAP.AREAS_PANE)?.contains(area.getElement() ?? null)).toBe(true);
    fresh.remove();

    await switchBaseLayer(map, 'osm');
    expect(area.getLatLngs()).toEqual(before.latLngs);
    expect(pathData(area)).toBe(before.d);
  });

  it('keeps a draft in progress: its vertices survive, and drawing goes on', async () => {
    const draw = createPolygonDraw(map, { pane: MAP.DRAFTS_PANE });
    const changes: number[][][] = [];
    onDraw(map, 'draw:change', ({ vertices }) => changes.push(vertices));
    /** A drawing click as Leaflet.Editable sees it (mousedown + mouseup on the map). */
    const click = (latlng: L.LatLng) => {
      const originalEvent = new MouseEvent('mousedown', { which: 1, clientX: 10, clientY: 10 });
      map.fire('mousedown', { latlng, originalEvent });
      map.fire('mouseup', { latlng, originalEvent });
    };
    draw.enable();
    triangle.forEach(click);
    const vertices = draw.getVertices();
    expect(vertices).toHaveLength(3);

    await switchBaseLayer(map, 'aerial');
    expect(draw.enabled()).toBe(true);
    expect(draw.getVertices()).toEqual(vertices);
    const handle = container.querySelector<HTMLElement>('.cgis-draw-handle');
    expect(handle && L.DomUtil.getPosition(handle)).toEqual(
      map.latLngToLayerPoint(triangle[0]!).round(),
    );

    click(L.latLng(32.0785, 34.772));
    expect(changes.at(-1)).toEqual([...vertices, [34.772, 32.0785]]);
    expect(draw.finish()).toBe(true);
  });

  describe('crossfade', () => {
    let finish: () => void;
    let animate: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      reducedMotion = false;
      const finished = new Promise<void>((resolve) => (finish = resolve));
      animate = vi.fn(() => ({ finished }));
      // jsdom has no Web Animations.
      Object.defineProperty(HTMLElement.prototype, 'animate', {
        value: animate,
        configurable: true,
      });
    });

    afterEach(() => {
      Reflect.deleteProperty(HTMLElement.prototype, 'animate');
    });

    const snapshots = () => map.getPanes().tilePane.querySelectorAll(`.${SNAPSHOT_CLASS}`);

    it('fades the new base layer in over a still copy of the old one for CROSSFADE_MS', async () => {
      const [osm] = gridLayers();
      const osmTiles = osm?.getContainer()?.querySelectorAll('img').length;
      expect(osmTiles).toBeGreaterThan(0);
      // Panned: the reset moves the map pane back to 0,0; the copy keeps the tiles where they were.
      map.panBy([120, -40], { animate: false });
      const panned = L.DomUtil.getPosition(map.getPanes().mapPane);
      expect(panned).toEqual(L.point(-120, 40));

      await switchBaseLayer(map, 'aerial');

      const [aerial] = gridLayers();
      expect(animate).toHaveBeenCalledOnce();
      expect(animate).toHaveBeenCalledWith([{ opacity: 0 }, { opacity: 1 }], MAP.CROSSFADE_MS);
      expect(animate.mock.contexts[0]).toBe(aerial?.getContainer());
      // The copy holds the OSM tiles and sits under the aerial layer (earlier in the tile pane).
      const [snapshot, ...others] = snapshots();
      expect(others).toHaveLength(0);
      expect(snapshot?.querySelectorAll('img')).toHaveLength(osmTiles ?? -1);
      expect(snapshot?.querySelector('img')?.src).toContain('tile.openstreetmap.org');
      expect(snapshot?.nextElementSibling).toBe(aerial?.getContainer());
      expect(L.DomUtil.getPosition(map.getPanes().mapPane)).toEqual(L.point(0, 0));
      expect(snapshot instanceof HTMLElement && L.DomUtil.getPosition(snapshot)).toEqual(panned);

      finish();
      await vi.waitFor(() => expect(snapshots()).toHaveLength(0));
    });

    it('does not fade under prefers-reduced-motion', async () => {
      reducedMotion = true;
      await switchBaseLayer(map, 'aerial');
      expect(animate).not.toHaveBeenCalled();
      expect(snapshots()).toHaveLength(0);
    });

    it('drops an unfinished copy when the next switch starts', async () => {
      await switchBaseLayer(map, 'aerial');
      await switchBaseLayer(map, 'osm');
      const [snapshot, ...others] = snapshots();
      expect(others).toHaveLength(0);
      expect(snapshot?.querySelector('img')?.src).toContain(GOVMAP.TILE_HOST);
    });
  });
});
