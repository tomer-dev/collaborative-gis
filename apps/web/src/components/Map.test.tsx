import { MAP } from '@cgis/shared/constants';
import { cleanup, render, screen } from '@testing-library/react';
import L from 'leaflet';
import { StrictMode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { boundsToBbox } from '../lib/map';
import { MapView, type MapViewProps } from './Map';

// jsdom has no ResizeObserver; this fake records each instance so a test can fire its callback.
let observers: FakeResizeObserver[] = [];
class FakeResizeObserver implements ResizeObserver {
  callback: ResizeObserverCallback;
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    observers.push(this);
  }
}

beforeEach(() => {
  observers = [];
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderMap(props: Omit<MapViewProps, 'onReady'> = {}) {
  const maps: L.Map[] = [];
  const onReady = vi.fn((map: L.Map) => maps.push(map));
  const view = render(<MapView onReady={onReady} {...props} />);
  const map = maps.at(-1);
  if (!map) throw new Error('onReady was not called on mount');
  return { ...view, map, onReady };
}

const israel = L.latLngBounds([
  [31.9, 34.7],
  [32.2, 35.0],
]);

it('creates the map at the default view with the OSM layer and both overlay panes', () => {
  const { map, onReady } = renderMap();

  expect(onReady).toHaveBeenCalledTimes(1);
  const center = map.getCenter();
  expect(center.lat).toBeCloseTo(MAP.DEFAULT_CENTER[0], 6);
  expect(center.lng).toBeCloseTo(MAP.DEFAULT_CENTER[1], 6);
  expect(map.getZoom()).toBe(MAP.DEFAULT_ZOOM);

  expect(map.getPane(MAP.AREAS_PANE)?.style.zIndex).toBe(String(MAP.AREAS_PANE_Z));
  expect(map.getPane(MAP.DRAFTS_PANE)?.style.zIndex).toBe(String(MAP.DRAFTS_PANE_Z));

  const tileLayers: L.TileLayer[] = [];
  map.eachLayer((layer) => {
    if (layer instanceof L.TileLayer) tileLayers.push(layer);
  });
  expect(tileLayers).toHaveLength(1);
  expect(tileLayers[0]).toMatchObject({ _url: MAP.OSM_TILE_URL });
  expect(tileLayers[0]?.options.maxZoom).toBe(MAP.OSM_MAX_ZOOM);
  expect(tileLayers[0]?.getAttribution?.()).toBe(MAP.OSM_ATTRIBUTION);

  expect(screen.getByRole('region', { name: 'Map' })).toBe(map.getContainer());
});

it('animates zoom and tile fades only when the OS allows motion', () => {
  expect(renderMap().map.options).toMatchObject({ zoomAnimation: true, fadeAnimation: true });
  cleanup();

  vi.stubGlobal('matchMedia', (query: string) => ({
    media: query,
    matches: query === '(prefers-reduced-motion: reduce)',
  }));
  expect(renderMap().map.options).toMatchObject({
    zoomAnimation: false,
    fadeAnimation: false,
    markerZoomAnimation: false,
  });
});

it('invalidates the map size when its container resizes', () => {
  const { map } = renderMap();
  const invalidateSize = vi.spyOn(map, 'invalidateSize');

  expect(observers).toHaveLength(1);
  const [observer] = observers;
  expect(observer?.observe).toHaveBeenCalledWith(map.getContainer());

  observer?.callback([], observer);
  expect(invalidateSize).toHaveBeenCalledTimes(1);
});

it('reports the initial bbox, then one debounced bbox per burst of moveend events', () => {
  vi.useFakeTimers();
  const onBoundsChange = vi.fn();
  const { map } = renderMap({ onBoundsChange });

  expect(onBoundsChange).toHaveBeenCalledTimes(1);
  expect(onBoundsChange).toHaveBeenLastCalledWith(boundsToBbox(map), map.getZoom());

  vi.spyOn(map, 'getBounds').mockReturnValue(israel);
  map.fire('moveend');
  vi.advanceTimersByTime(MAP.MOVEEND_DEBOUNCE_MS - 1);
  map.fire('moveend');
  vi.advanceTimersByTime(MAP.MOVEEND_DEBOUNCE_MS - 1);
  expect(onBoundsChange).toHaveBeenCalledTimes(1);

  vi.advanceTimersByTime(1);
  expect(onBoundsChange).toHaveBeenCalledTimes(2);
  expect(onBoundsChange).toHaveBeenLastCalledWith(
    [expect.closeTo(34.7, 9), 31.9, expect.closeTo(35.0, 9), 32.2],
    map.getZoom(),
  );
});

it('keeps one map across re-renders and calls the latest onBoundsChange', () => {
  vi.useFakeTimers();
  const first = vi.fn();
  const second = vi.fn();
  const { map, onReady, rerender } = renderMap({ onBoundsChange: first });

  rerender(<MapView onReady={onReady} onBoundsChange={second} />);
  map.fire('moveend');
  vi.advanceTimersByTime(MAP.MOVEEND_DEBOUNCE_MS);

  expect(onReady).toHaveBeenCalledTimes(1);
  expect(first).toHaveBeenCalledTimes(1); // the initial bbox only
  expect(second).toHaveBeenCalledTimes(1);
});

it('removes the map, its observer and any pending bbox report on unmount', () => {
  vi.useFakeTimers();
  const onBoundsChange = vi.fn();
  const { map, unmount } = renderMap({ onBoundsChange });
  const remove = vi.spyOn(map, 'remove');

  map.fire('moveend');
  unmount();
  vi.advanceTimersByTime(MAP.MOVEEND_DEBOUNCE_MS);

  expect(remove).toHaveBeenCalledTimes(1);
  expect(observers[0]?.disconnect).toHaveBeenCalledTimes(1);
  expect(onBoundsChange).toHaveBeenCalledTimes(1); // the initial bbox only
});

it("survives StrictMode's mount, unmount, mount on the same container", () => {
  const onReady = vi.fn();
  render(
    <StrictMode>
      <MapView onReady={onReady} />
    </StrictMode>,
  );

  expect(onReady).toHaveBeenCalledTimes(2);
  const container = screen.getByRole('region', { name: 'Map' });
  expect(container.querySelectorAll('.leaflet-map-pane')).toHaveLength(1);
});
