import { MAP, type Area } from '@cgis/shared';
import { cleanup, render } from '@testing-library/react';
import * as L from 'leaflet';
import { StrictMode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AREA_ID, makeArea, OTHER_ID } from '../test/api-stub';
import { MAP_CLASS } from '../ui';
import { AreasLayer } from './AreasLayer';

let map: L.Map;
let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement('div');
  // jsdom has no layout: Leaflet reads the map size from clientWidth/clientHeight.
  Object.defineProperty(container, 'clientWidth', { value: 800 });
  Object.defineProperty(container, 'clientHeight', { value: 600 });
  document.body.append(container);
  map = L.map(container, { center: [32.05, 34.95], zoom: 10 });
  map.createPane(MAP.AREAS_PANE);
});

afterEach(() => {
  cleanup();
  map.remove();
  container.remove();
});

const orchard = makeArea(AREA_ID);
const vineyard = makeArea(OTHER_ID, {
  name: 'Vineyard',
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [34.7, 31.9],
        [34.8, 31.9],
        [34.8, 32],
        [34.7, 31.9],
      ],
    ],
  },
});

/** The polygons on the map, by the pane they were drawn in. */
function polygons(): L.Polygon[] {
  const found: L.Polygon[] = [];
  map.eachLayer((layer) => {
    if (layer instanceof L.Polygon) found.push(layer);
  });
  return found;
}
const paths = () => map.getPane(MAP.AREAS_PANE)?.querySelectorAll('path') ?? [];

function renderLayer(areas: Area[], selectedId: string | null = null) {
  const onSelect = vi.fn<(area: Area) => void>();
  const view = render(
    <AreasLayer map={map} areas={areas} selectedId={selectedId} onSelect={onSelect} />,
  );
  const rerender = (next: Area[], nextSelected: string | null = selectedId) =>
    view.rerender(
      <AreasLayer map={map} areas={next} selectedId={nextSelected} onSelect={onSelect} />,
    );
  return { ...view, onSelect, rerender };
}

it('draws one polygon per area in the areas pane, at the GeoJSON ring flipped to [lat, lng]', () => {
  renderLayer([orchard, vineyard]);

  expect(polygons()).toHaveLength(2);
  expect(polygons().every((polygon) => polygon.options.pane === MAP.AREAS_PANE)).toBe(true);
  expect(paths()).toHaveLength(2);
  // Leaflet drops the closing vertex of the ring.
  const [first] = polygons();
  expect(first?.getLatLngs()).toEqual([
    [L.latLng(32, 34.9), L.latLng(32, 35), L.latLng(32.1, 35), L.latLng(32.1, 34.9)],
  ]);
});

it('keeps the layer of an area that stays, adds new ids and removes the ones that disappear', () => {
  const { rerender } = renderLayer([orchard]);
  const [kept] = polygons();

  rerender([orchard, vineyard]);
  expect(polygons()).toHaveLength(2);
  expect(polygons()).toContain(kept);

  rerender([vineyard]);
  expect(polygons()).toHaveLength(1);
  expect(polygons()).not.toContain(kept);
  expect(paths()).toHaveLength(1);
});

it('moves a polygon when its geometry changes, in place', () => {
  const { rerender } = renderLayer([orchard]);
  const [polygon] = polygons();

  rerender([{ ...orchard, version: 2, geometry: vineyard.geometry }]);

  expect(polygons()).toEqual([polygon]);
  expect(polygon?.getLatLngs()).toEqual([
    [L.latLng(31.9, 34.7), L.latLng(31.9, 34.8), L.latLng(32, 34.8)],
  ]);
});

it('selects the clicked area (its latest copy) and gives the selected one the selected class', () => {
  const { onSelect, rerender } = renderLayer([orchard, vineyard]);
  const renamed = { ...orchard, name: 'Renamed', version: 2 };
  rerender([renamed, vineyard]);

  paths()[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  expect(onSelect).toHaveBeenCalledWith(renamed);

  rerender([renamed, vineyard], AREA_ID);
  const [selected, other] = polygons().map((polygon) => polygon.getElement());
  expect(selected?.classList.contains(MAP_CLASS.areaSelected)).toBe(true);
  expect(selected?.classList.contains(MAP_CLASS.area)).toBe(false);
  expect(other?.classList.contains(MAP_CLASS.area)).toBe(true);
});

it('ignores a click on an area still being created (pending id), then selects it once saved', () => {
  const onSelect = vi.fn<(area: Area) => void>();
  const view = render(
    <AreasLayer
      map={map}
      areas={[orchard]}
      selectedId={null}
      onSelect={onSelect}
      pendingIds={new Set([orchard.id])}
    />,
  );
  paths()[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  expect(onSelect).not.toHaveBeenCalled();

  view.rerender(<AreasLayer map={map} areas={[orchard]} selectedId={null} onSelect={onSelect} />);
  paths()[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  expect(onSelect).toHaveBeenCalledWith(orchard);
});

it('takes its polygons off the map on unmount, and survives StrictMode', () => {
  const view = render(
    <StrictMode>
      <AreasLayer map={map} areas={[orchard, vineyard]} selectedId={null} onSelect={() => {}} />
    </StrictMode>,
  );
  expect(polygons()).toHaveLength(2);

  view.unmount();
  expect(polygons()).toHaveLength(0);
});
