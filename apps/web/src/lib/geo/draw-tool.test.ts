import { DRAW, MAP } from '@cgis/shared';
import * as L from 'leaflet';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { onDraw, type DrawEvent, type DrawEventType } from './draw-events';
import { createPolygonDraw, type PolygonDrawOptions } from './draw-tool';
import { ringAreaKm2 } from './geodesic';

let map: L.Map;
let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement('div');
  // jsdom has no layout: Leaflet reads the map size from clientWidth/clientHeight.
  Object.defineProperty(container, 'clientWidth', { value: 800 });
  Object.defineProperty(container, 'clientHeight', { value: 600 });
  document.body.append(container);
  map = L.map(container, { center: [32, 35], zoom: 12 });
});

afterEach(() => {
  map.remove();
  container.remove();
});

/**
 * A map click as Leaflet.Editable sees it: it listens to the map's mousedown + mouseup (left
 * button, `which === 1`, under 9 px apart) and treats the pair as a drawing click.
 */
const click = (lat: number, lng: number) => {
  const latlng = L.latLng(lat, lng);
  const originalEvent = new MouseEvent('mousedown', { which: 1, clientX: 10, clientY: 10 });
  map.fire('mousedown', { latlng, originalEvent });
  map.fire('mouseup', { latlng, originalEvent });
};
const triangle = () => {
  click(32, 35);
  click(32, 35.05);
  click(32.05, 35.05);
};
const bowtie = () => {
  click(32, 35);
  click(32.05, 35.05);
  click(32, 35.05);
  click(32.05, 35);
};
const record = <K extends DrawEventType>(type: K) => {
  const events: DrawEvent<K>[] = [];
  onDraw(map, type, (e) => events.push(e));
  return events;
};
const start = (options?: PolygonDrawOptions) => {
  const draw = createPolygonDraw(map, options);
  draw.enable();
  return draw;
};
const handles = () => container.querySelectorAll<HTMLElement>('.cgis-draw-handle');
const sketchPaths = () => container.querySelectorAll('path.cgis-draw-sketch');
const clickHandle = (handle: HTMLElement) =>
  handle.dispatchEvent(new MouseEvent('click', { bubbles: true }));

describe('createPolygonDraw (Leaflet.Editable)', () => {
  it('creates map.editTools once and styles through classes: handle hit box, sketch class and DRAFT_STYLE', () => {
    const draw = start();
    const tools = map.editTools;
    expect(tools).toBeDefined();
    triangle();
    const [first, second] = handles();
    expect(handles()).toHaveLength(3);
    expect(first!.classList.contains('cgis-draw-handle--first')).toBe(true);
    expect(second!.classList.contains('cgis-draw-handle--first')).toBe(false);
    expect(first!.style.width).toBe(`${MAP.HANDLE_HIT_PX}px`);
    expect(first!.style.height).toBe(`${MAP.HANDLE_HIT_PX}px`);
    expect(first!.innerHTML).toBe('');
    // Pointer-only targets with no name: none of them is a tab stop.
    expect([...handles()].map((handle) => handle.tabIndex)).toEqual([-1, -1, -1]);
    expect(sketchPaths()).toHaveLength(1);
    expect(sketchPaths()[0]!.getAttribute('stroke-width')).toBe(String(MAP.DRAFT_STYLE.weight));

    draw.disable();
    expect(handles()).toHaveLength(0);
    expect(sketchPaths()).toHaveLength(0);
    draw.enable();
    expect(map.editTools).toBe(tools);
  });

  it('adds a vertex per click and reports [lng, lat] vertices on draw:change', () => {
    const changes = record('draw:change');
    const draw = start();
    triangle();
    expect(changes).toHaveLength(3);
    expect(changes[2]!.vertices).toEqual([
      [35, 32],
      [35.05, 32],
      [35.05, 32.05],
    ]);
    expect(draw.getVertices()).toEqual(changes[2]!.vertices);
  });

  it('finish() closes 3 vertices into a closed GeoJSON ring on draw:done and stops drawing', () => {
    const done = record('draw:done');
    const draw = start();
    triangle();
    expect(draw.finish()).toBe(true);
    expect(done).toHaveLength(1);
    const { ring } = done[0]!;
    expect(ring).toHaveLength(4);
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    expect(ringAreaKm2(ring)).toBeGreaterThan(0);
    expect(draw.enabled()).toBe(false);
    expect(handles()).toHaveLength(0);
    expect(sketchPaths()).toHaveLength(0);
  });

  it('clicking the first or the last handle commits a valid sketch', () => {
    const done = record('draw:done');
    const draw = start();
    triangle();
    clickHandle(handles()[0]!);
    expect(done).toHaveLength(1);
    expect(draw.enabled()).toBe(false);

    draw.enable();
    triangle();
    clickHandle(handles()[2]!); // the second click of a double-click lands on the new handle
    expect(done).toHaveLength(2);
  });

  it('undo() pops the last vertex; with one vertex left it is a no-op (Leaflet.Editable pop())', () => {
    const changes = record('draw:change');
    const draw = start();
    triangle();
    draw.undo();
    expect(draw.getVertices()).toEqual([
      [35, 32],
      [35.05, 32],
    ]);
    expect(changes.at(-1)!.vertices).toHaveLength(2);
    expect(handles()).toHaveLength(2);
    draw.undo();
    draw.undo();
    expect(draw.getVertices()).toHaveLength(1);
  });

  it('cancel(): draw:cancel, sketch and handles removed, handler disabled', () => {
    const cancels = record('draw:cancel');
    const done = record('draw:done');
    const draw = start();
    triangle();
    draw.cancel();
    expect(cancels).toHaveLength(1);
    expect(done).toHaveLength(0);
    expect(draw.enabled()).toBe(false);
    expect(draw.getVertices()).toEqual([]);
    expect(handles()).toHaveLength(0);
    expect(sketchPaths()).toHaveLength(0);
  });

  it('a bowtie does not finish: draw:invalid with the self-intersection reason, drawing continues', () => {
    const invalid = record('draw:invalid');
    const done = record('draw:done');
    const draw = start();
    bowtie();
    expect(draw.finish()).toBe(false);
    expect(done).toHaveLength(0);
    expect(invalid.map((e) => e.reason)).toEqual([DRAW.SELF_INTERSECTION_REASON]);
    expect(draw.enabled()).toBe(true);
    expect(draw.getVertices()).toHaveLength(4);
    click(32.1, 35.1); // still drawing: the next click adds a vertex
    expect(draw.getVertices()).toHaveLength(5);
  });

  it('a bowtie committed by a handle click: draw:invalid, the sketch stays (editable, not done)', () => {
    const invalid = record('draw:invalid');
    const done = record('draw:done');
    const draw = start();
    bowtie();
    clickHandle(handles()[0]!);
    expect(invalid.map((e) => e.reason)).toEqual([DRAW.SELF_INTERSECTION_REASON]);
    expect(done).toHaveLength(0);
    expect(draw.enabled()).toBe(true);
    expect(draw.getVertices()).toHaveLength(4);
    expect(handles()).toHaveLength(4);
  });

  it('fewer than 3 vertices does not finish: draw:invalid with the PolygonSchema reason', () => {
    const invalid = record('draw:invalid');
    const draw = start();
    click(32, 35);
    click(32, 35.05);
    expect(draw.finish()).toBe(false);
    expect(invalid).toHaveLength(1);
    expect(invalid[0]!.reason).toMatch(/at least 3 unique vertices/);
  });

  it('dragging a handle moves its vertex and fires draw:change on dragend', () => {
    const changes = record('draw:change');
    const draw = start();
    triangle();
    const before = draw.getVertices()[1]!;
    const handle = handles()[1]!;
    // A real Leaflet marker drag: mousedown, mousemove, mouseup on the icon (move/up bubble to
    // the document, where Leaflet listens). Leaflet 1.9 checks the legacy `which === 1` for the
    // left button; jsdom leaves it 0 unless given.
    const mouse = (type: string, clientX: number, clientY: number) =>
      handle.dispatchEvent(
        new MouseEvent(type, { bubbles: true, button: 0, which: 1, clientX, clientY }),
      );
    mouse('mousedown', 100, 100);
    mouse('mousemove', 140, 60);
    mouse('mouseup', 140, 60);
    const after = draw.getVertices()[1]!;
    expect(after[0]).toBeGreaterThan(before[0]); // moved east
    expect(after[1]).toBeGreaterThan(before[1]); // moved north
    expect(changes.at(-1)!.vertices[1]).toEqual(after);
  });

  it('puts the sketch in the requested pane, creating it if missing', () => {
    start({ pane: MAP.DRAFTS_PANE });
    triangle();
    const pane = map.getPane(MAP.DRAFTS_PANE)!;
    expect(pane).toBeDefined();
    expect(pane.querySelectorAll('path.cgis-draw-sketch')).toHaveLength(1);
  });
});
