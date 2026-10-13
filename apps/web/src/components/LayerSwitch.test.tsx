import { COPY, MAP } from '@cgis/shared';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as L from 'leaflet';
import { StrictMode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { govmapCrs } from '../lib/geo/govmap-crs';
import { switchBaseLayer } from '../lib/geo/layer-switch';
import { LayerSwitch } from './LayerSwitch';

// The real switch, wrapped so a test can await a call and read the signal it was given.
vi.mock('../lib/geo/layer-switch', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/geo/layer-switch')>();
  return { ...actual, switchBaseLayer: vi.fn(actual.switchBaseLayer) };
});

let map: L.Map;
let container: HTMLDivElement;

beforeEach(() => {
  // Reduced motion: no crossfade (jsdom has no Web Animations).
  vi.stubGlobal('matchMedia', (query: string) => ({ media: query, matches: true }));
  container = document.createElement('div');
  // jsdom has no layout: Leaflet reads the map size from clientWidth/clientHeight.
  Object.defineProperty(container, 'clientWidth', { value: 800 });
  Object.defineProperty(container, 'clientHeight', { value: 600 });
  document.body.append(container);
  map = L.map(container, { center: [32.078, 34.774], zoom: 16 });
  L.tileLayer(MAP.OSM_TILE_URL, { maxZoom: MAP.OSM_MAX_ZOOM }).addTo(map);
});

afterEach(() => {
  cleanup();
  vi.mocked(switchBaseLayer).mockClear();
  map.remove();
  container.remove();
  vi.unstubAllGlobals();
});

const toolbar = () => screen.getByRole('toolbar', { name: COPY.MAP.BASE_LAYER_LABEL });
const toggle = (name: string) => screen.getByRole('button', { name });
const pressed = (name: string) => toggle(name).getAttribute('aria-pressed');

it('sits in Leaflet’s top-left control corner with the OSM toggle pressed', () => {
  render(<LayerSwitch map={map} />);

  expect(container.querySelector('.leaflet-top.leaflet-left')?.contains(toolbar())).toBe(true);
  expect(pressed(COPY.MAP.OSM_LABEL)).toBe('true');
  expect(pressed(COPY.MAP.AERIAL_LABEL)).toBe('false');
});

it('switches the map to the aerial layer and back', async () => {
  render(<LayerSwitch map={map} />);

  fireEvent.click(toggle(COPY.MAP.AERIAL_LABEL));
  expect(pressed(COPY.MAP.AERIAL_LABEL)).toBe('true');
  expect(pressed(COPY.MAP.OSM_LABEL)).toBe('false');
  await waitFor(() => expect(map.options.crs).toBe(govmapCrs));

  fireEvent.click(toggle(COPY.MAP.OSM_LABEL));
  expect(pressed(COPY.MAP.OSM_LABEL)).toBe('true');
  await waitFor(() => expect(map.options.crs).toBe(L.CRS.EPSG3857));
});

it('keeps the last choice when a second click lands while the aerial modules load', async () => {
  render(<LayerSwitch map={map} />);

  fireEvent.click(toggle(COPY.MAP.AERIAL_LABEL));
  fireEvent.click(toggle(COPY.MAP.OSM_LABEL));

  const { calls, results } = vi.mocked(switchBaseLayer).mock;
  const toAerial = calls.findIndex(([, target]) => target === 'aerial');
  const result = results[toAerial];
  if (result?.type !== 'return') throw new Error('no switch to aerial was started');
  await act(() => result.value);
  expect(calls[toAerial]?.[2]?.aborted).toBe(true);
  expect(map.options.crs).toBe(L.CRS.EPSG3857);
  expect(pressed(COPY.MAP.OSM_LABEL)).toBe('true');
});

it('keeps its clicks away from the map (no stray draw vertex)', () => {
  const mapClick = vi.fn();
  const mapMousedown = vi.fn();
  map.on('click', mapClick).on('mousedown', mapMousedown);
  render(<LayerSwitch map={map} />);

  fireEvent.mouseDown(toggle(COPY.MAP.OSM_LABEL));
  fireEvent.click(toggle(COPY.MAP.OSM_LABEL));

  expect(mapMousedown).not.toHaveBeenCalled();
  expect(mapClick).not.toHaveBeenCalled();
});

it('takes its control off the map on unmount, once under StrictMode', () => {
  const controls = () => container.querySelectorAll('.leaflet-top.leaflet-left > .leaflet-control');
  expect(controls()).toHaveLength(1); // Leaflet's zoom buttons
  const { unmount } = render(
    <StrictMode>
      <LayerSwitch map={map} />
    </StrictMode>,
  );
  expect(controls()).toHaveLength(2);
  expect(controls()[1]?.contains(toolbar())).toBe(true);

  unmount();

  expect(controls()).toHaveLength(1);
  expect(screen.queryByRole('toolbar', { name: COPY.MAP.BASE_LAYER_LABEL })).toBeNull();
});
