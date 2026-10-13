import { DRAW } from '@cgis/shared';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import * as L from 'leaflet';
import { StrictMode, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  createPolygonDraw,
  invalidReason,
  ringAreaKm2,
  ringAreaM2,
  type DrawEvent,
  type DrawEventType,
  type LngLat,
  type PolygonDraw,
} from '../lib/geo';
import { DrawControl } from './DrawControl';

// Wrap the real factory so a test can reach the tool the control created (it keeps it private).
vi.mock('../lib/geo', async (importOriginal) => {
  const geo = await importOriginal<typeof import('../lib/geo')>();
  return { ...geo, createPolygonDraw: vi.fn(geo.createPolygonDraw) };
});

let map: L.Map;
let container: HTMLDivElement;

function createMap() {
  const element = document.createElement('div');
  // jsdom has no layout: Leaflet reads the map size from clientWidth/clientHeight.
  Object.defineProperty(element, 'clientWidth', { value: 800 });
  Object.defineProperty(element, 'clientHeight', { value: 600 });
  document.body.append(element);
  return { element, map: L.map(element, { center: [32, 35], zoom: 12 }) };
}

beforeEach(() => {
  ({ element: container, map } = createMap());
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  map.remove();
  container.remove();
});

// 0.1° box at 32°N (the T11 acceptance square), open: draw:change never repeats the first vertex.
const square: LngLat[] = [
  [34.9, 32],
  [35, 32],
  [35, 32.1],
  [34.9, 32.1],
];
// About 0.26 km², so the readout switches to m².
const triangle: LngLat[] = [
  [34.8, 32],
  [34.81, 32],
  [34.8, 32.005],
];
// 1° box, past 1,000 km²: the km² readout gets a thousands separator.
const degreeBox: LngLat[] = [
  [34, 31],
  [35, 31],
  [35, 32],
  [34, 32],
];
const closedSquare: LngLat[] = [...square, [34.9, 32]];

/** Renders the control; `handler()` is the PolygonDraw it last created (the control keeps it private). */
function renderControl(ui: (props: { onDone: (ring: LngLat[]) => void }) => ReactNode) {
  vi.mocked(createPolygonDraw).mockClear();
  const onDone = vi.fn<(ring: LngLat[]) => void>();
  const view = render(ui({ onDone }));
  const handler = (): PolygonDraw => {
    const created = vi.mocked(createPolygonDraw).mock.results.at(-1);
    if (created?.type !== 'return') throw new Error('no PolygonDraw was created');
    return created.value;
  };
  return { ...view, onDone, handler };
}
const renderOnMap = () => renderControl(({ onDone }) => <DrawControl map={map} onDone={onDone} />);

const button = (name: string) => screen.getByRole<HTMLButtonElement>('button', { name });
const startDrawing = () => fireEvent.click(button(DRAW.START_LABEL));
const fire = <K extends DrawEventType>(type: K, data?: Omit<DrawEvent<K>, keyof L.LeafletEvent>) =>
  act(() => {
    map.fire(type, data);
  });
/** A map click as Leaflet.Editable reads it: the map's mousedown + mouseup, left button, in place. */
const clickOn = (target: L.Map, lat: number, lng: number) => {
  const latlng = L.latLng(lat, lng);
  const originalEvent = new MouseEvent('mousedown', { which: 1, clientX: 10, clientY: 10 });
  target.fire('mousedown', { latlng, originalEvent });
  target.fire('mouseup', { latlng, originalEvent });
};
const readout = (label: string) => screen.getByRole('status', { name: label }).textContent;
const panel = () => screen.queryByRole('region', { name: DRAW.PANEL_TITLE });

it('starts idle with the draw button; clicking it enables the handler and shows the drawing panel', () => {
  const { handler } = renderOnMap();

  expect(screen.getByRole('toolbar', { name: DRAW.TOOLBAR_LABEL })).toBeTruthy();
  expect(panel()).toBeNull();
  // Mounting does not take focus; only the end of a sketch moves it to the button.
  expect(document.activeElement).toBe(document.body);

  startDrawing();

  expect(handler().enabled()).toBe(true);
  expect(screen.queryByRole('button', { name: DRAW.START_LABEL })).toBeNull();
  expect(panel()).toBeTruthy();
  // The start button is gone: focus moves to the panel's Cancel, not to the page.
  expect(document.activeElement).toBe(button(DRAW.CANCEL_LABEL));
  for (const name of [DRAW.FINISH_LABEL, DRAW.UNDO_LABEL, DRAW.CANCEL_LABEL]) {
    expect(button(name)).toBeTruthy();
  }
  // No vertices yet: no area, and nothing to undo.
  expect(
    within(screen.getByRole('status', { name: DRAW.AREA_LABEL })).getByText('No value'),
  ).toBeTruthy();
  expect(readout(DRAW.VERTICES_LABEL)).toBe('0 / 999');
  expect(button(DRAW.UNDO_LABEL).disabled).toBe(true);
});

it('shows the live area in km² with 3 decimals and the vertex count on draw:change', () => {
  renderOnMap();
  startDrawing();

  fire('draw:change', { vertices: square });
  // The readout is ringAreaKm2's value, rounded for display.
  expect(ringAreaKm2(square).toFixed(3)).toBe('104.798');
  expect(readout(DRAW.AREA_LABEL)).toBe('104.798 km²');
  expect(readout(DRAW.VERTICES_LABEL)).toBe('4 / 999');

  fire('draw:change', { vertices: degreeBox });
  expect(readout(DRAW.AREA_LABEL)).toBe('10,542.204 km²');
});

it('shows an area under 1 km² in whole m²', () => {
  renderOnMap();
  startDrawing();

  fire('draw:change', { vertices: triangle });

  expect(Math.round(ringAreaM2(triangle))).toBe(262132);
  expect(readout(DRAW.AREA_LABEL)).toBe('262,132 m²');
  expect(readout(DRAW.VERTICES_LABEL)).toBe('3 / 999');
});

it('shows the draw:invalid reason as an alert until the next draw:change', () => {
  renderOnMap();
  startDrawing();
  expect(screen.queryByRole('alert')).toBeNull();

  fire('draw:invalid', { reason: 'x' });
  expect(screen.getByRole('alert').textContent).toBe('x');

  fire('draw:change', { vertices: triangle });
  expect(screen.queryByRole('alert')).toBeNull();
});

it('hands the ring to onDone on draw:done and returns to idle', () => {
  const { onDone } = renderOnMap();
  startDrawing();

  fire('draw:done', { ring: closedSquare });

  expect(onDone).toHaveBeenCalledExactlyOnceWith(closedSquare);
  expect(panel()).toBeNull();
  expect(document.activeElement).toBe(button(DRAW.START_LABEL));
});

it('returns to idle on draw:cancel without calling onDone', () => {
  const { onDone } = renderOnMap();
  startDrawing();

  fire('draw:cancel');

  expect(onDone).not.toHaveBeenCalled();
  expect(panel()).toBeNull();
  expect(document.activeElement).toBe(button(DRAW.START_LABEL));
});

it('drives the handler from Undo and Finish: a too-small ring alerts, a valid one is done', () => {
  const { handler, onDone } = renderOnMap();
  startDrawing();
  const add = (vertices: LngLat[]) =>
    act(() => {
      for (const [lng, lat] of vertices) clickOn(map, lat, lng);
    });

  add(square.slice(0, 2));
  expect(readout(DRAW.VERTICES_LABEL)).toBe('2 / 999');
  fireEvent.click(button(DRAW.FINISH_LABEL));
  expect(screen.getByRole('alert').textContent).toBe(invalidReason(square.slice(0, 2)));
  expect(handler().enabled()).toBe(true);

  add(square.slice(2));
  fireEvent.click(button(DRAW.UNDO_LABEL));
  expect(readout(DRAW.VERTICES_LABEL)).toBe('3 / 999');
  expect(screen.queryByRole('alert')).toBeNull();

  fireEvent.click(button(DRAW.FINISH_LABEL));
  expect(onDone).toHaveBeenCalledExactlyOnceWith(square.slice(0, 3).concat(square.slice(0, 1)));
  expect(handler().enabled()).toBe(false);
  expect(document.activeElement).toBe(button(DRAW.START_LABEL));
});

it('discards the sketch from Cancel', () => {
  const { handler, onDone } = renderOnMap();
  startDrawing();
  act(() => clickOn(map, 32, 35));

  fireEvent.click(button(DRAW.CANCEL_LABEL));

  expect(handler().enabled()).toBe(false);
  expect(handler().getVertices()).toEqual([]);
  expect(onDone).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(button(DRAW.START_LABEL));
});

it('discards the sketch on Escape, as Cancel does, unless a text field or a dialog has it', () => {
  const { handler, onDone } = renderOnMap();
  startDrawing();
  act(() => clickOn(map, 32, 35));

  // The rename field's (or a dialog's) Escape is theirs: the sketch stays.
  const field = document.createElement('input');
  const dialog = document.createElement('dialog');
  document.body.append(field, dialog);
  fireEvent.keyDown(field, { key: 'Escape' });
  fireEvent.keyDown(dialog, { key: 'Escape' });
  expect(handler().enabled()).toBe(true);
  field.remove();
  dialog.remove();

  fireEvent.keyDown(document, { key: 'Escape' });

  expect(handler().enabled()).toBe(false);
  expect(handler().getVertices()).toEqual([]);
  expect(onDone).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(button(DRAW.START_LABEL));
});

it('counts placed vertices up to the reachable cap, 999, where the handler stops', () => {
  renderOnMap();
  startDrawing();

  act(() => {
    for (let i = 0; i < 999; i++) clickOn(map, 32 + i * 1e-4, 35 + (i % 2) * 1e-4);
  });
  expect(readout(DRAW.VERTICES_LABEL)).toBe('999 / 999');
  expect(screen.queryByRole('alert')).toBeNull();

  act(() => clickOn(map, 33, 36));
  expect(readout(DRAW.VERTICES_LABEL)).toBe('999 / 999');
  expect(screen.getByRole('alert').textContent).toBe(DRAW.MAX_VERTICES_REASON);
});

it('disables the handler and stops listening on unmount', () => {
  const { handler, onDone, unmount, container: root } = renderOnMap();
  startDrawing();
  fire('draw:change', { vertices: square });
  const draw = handler();

  unmount();

  expect(draw.enabled()).toBe(false);
  expect(() => fire('draw:change', { vertices: triangle })).not.toThrow();
  fire('draw:done', { ring: closedSquare });
  expect(onDone).not.toHaveBeenCalled();
  expect(root.innerHTML).toBe('');
});

it('survives the map being removed before the control unmounts (route teardown order)', () => {
  // Its own map: afterEach must not remove a removed map a second time.
  const own = createMap();
  const { handler, unmount } = renderControl(({ onDone }) => (
    <DrawControl map={own.map} onDone={onDone} />
  ));
  startDrawing();
  act(() => clickOn(own.map, 32, 35));

  own.map.remove();

  expect(() => unmount()).not.toThrow();
  expect(handler().enabled()).toBe(false);
  own.element.remove();
});

it('starts over on a new map: the old handler is disabled and unsubscribed', () => {
  const { handler, onDone, rerender } = renderOnMap();
  startDrawing();
  const first = handler();
  const other = createMap();

  rerender(<DrawControl map={other.map} onDone={onDone} />);

  expect(first.enabled()).toBe(false);
  expect(button(DRAW.START_LABEL)).toBeTruthy();

  startDrawing();
  expect(handler()).not.toBe(first);
  expect(handler().enabled()).toBe(true);
  // `fire` targets the old map, which nothing listens to any more.
  fire('draw:change', { vertices: square });
  fire('draw:done', { ring: closedSquare });
  expect(readout(DRAW.VERTICES_LABEL)).toBe('0 / 999');
  expect(onDone).not.toHaveBeenCalled();
  // The new map's events do reach the control.
  act(() => {
    other.map.fire('draw:change', { vertices: triangle });
  });
  expect(readout(DRAW.VERTICES_LABEL)).toBe('3 / 999');

  other.map.remove();
  other.element.remove();
});

it('subscribes once under StrictMode', () => {
  const { onDone } = renderControl(({ onDone }) => (
    <StrictMode>
      <DrawControl map={map} onDone={onDone} />
    </StrictMode>
  ));
  startDrawing();

  fire('draw:done', { ring: closedSquare });

  expect(onDone).toHaveBeenCalledTimes(1);
});
