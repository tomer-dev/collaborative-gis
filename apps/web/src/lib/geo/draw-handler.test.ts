import { DRAW, MAP } from '@cgis/shared';
import * as L from 'leaflet';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { PolygonDraw, onDraw, type DrawEvent, type DrawEventType } from './draw-handler';
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
const handles = () => container.querySelectorAll<HTMLElement>('.cgis-draw-handle');
const sketchPaths = () => container.querySelectorAll('path.cgis-draw-sketch');
const clickHandle = (handle: HTMLElement) =>
  handle.dispatchEvent(new MouseEvent('click', { bubbles: true }));

describe('PolygonDraw (Leaflet.Editable)', () => {
  it('creates map.editTools once and styles through classes: handle hit box, sketch class and DRAFT_STYLE', () => {
    const draw = new PolygonDraw(map).enable();
    const tools = map.editTools;
    expect(tools).toBeDefined();
    triangle();
    const [first] = handles();
    expect(handles()).toHaveLength(3);
    expect(first!.style.width).toBe(`${MAP.HANDLE_HIT_PX}px`);
    expect(first!.style.height).toBe(`${MAP.HANDLE_HIT_PX}px`);
    expect(first!.innerHTML).toBe('');
    expect(sketchPaths()).toHaveLength(1);
    expect(sketchPaths()[0]!.getAttribute('stroke-width')).toBe(String(MAP.DRAFT_STYLE.weight));

    draw.disable();
    expect(handles()).toHaveLength(0);
    expect(sketchPaths()).toHaveLength(0);
    draw.enable();
    expect(map.editTools).toBe(tools);
  });

  it('adds a vertex per click and reports [lng, lat] vertices on draw:vertex / draw:change', () => {
    const changes = record('draw:change');
    const added = record('draw:vertex');
    const draw = new PolygonDraw(map).enable();
    triangle();
    expect(added.map((e) => e.index)).toEqual([0, 1, 2]);
    expect(added[1]!.vertex).toEqual([35.05, 32]);
    expect(changes).toHaveLength(3);
    expect(changes[2]!.vertices).toEqual([
      [35, 32],
      [35.05, 32],
      [35.05, 32.05],
    ]);
    expect(draw.getVertices()).toEqual(changes[2]!.vertices);
    expect(draw.getAreaKm2()).toBeCloseTo(ringAreaKm2(draw.getVertices()), 9);
    expect(draw.getAreaKm2()).toBeGreaterThan(0);
  });

  it('finish() closes 3 vertices into a closed GeoJSON ring on draw:done and stops drawing', () => {
    const done = record('draw:done');
    const draw = new PolygonDraw(map).enable();
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
    const draw = new PolygonDraw(map).enable();
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
    const draw = new PolygonDraw(map).enable();
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
    const draw = new PolygonDraw(map).enable();
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
    const draw = new PolygonDraw(map).enable();
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
    const draw = new PolygonDraw(map).enable();
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
    const draw = new PolygonDraw(map).enable();
    click(32, 35);
    click(32, 35.05);
    expect(draw.finish()).toBe(false);
    expect(invalid).toHaveLength(1);
    expect(invalid[0]!.reason).toMatch(/at least 3 unique vertices/);
  });

  it('refuses a click past the cap (maxVertices − 1 placed): draw:invalid, no vertex added', () => {
    const invalid = record('draw:invalid');
    const draw = new PolygonDraw(map, { maxVertices: 4 }).enable();
    triangle();
    click(32.05, 35);
    expect(draw.getVertices()).toHaveLength(3);
    expect(invalid.map((e) => e.reason)).toEqual([DRAW.MAX_VERTICES_REASON]);
  });

  it('defaults maxVertices to LIMITS.POLYGON_MAX_VERTICES', () => {
    const draw = new PolygonDraw(map);
    expect(draw.options.maxVertices).toBe(1000);
  });

  it('onDraw parses the payload: a malformed draw:change throws a ZodError from map.fire', () => {
    // Our own events: a bad payload is a bug, so the subscriber throws rather than skipping it.
    const changes = record('draw:change');
    expect(() => map.fire('draw:change', { vertices: [[200, 0]] })).toThrow(ZodError);
    expect(() => map.fire('draw:change', {})).toThrow(ZodError);
    expect(changes).toHaveLength(0);
    map.fire('draw:change', { vertices: [[35, 32]] });
    expect(changes[0]!.vertices).toEqual([[35, 32]]);
    expect(changes[0]!.type).toBe('draw:change');
  });

  it('dragging a handle moves its vertex and fires draw:change on dragend', () => {
    const changes = record('draw:change');
    const draw = new PolygonDraw(map).enable();
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
    new PolygonDraw(map, { pane: MAP.DRAFTS_PANE }).enable();
    triangle();
    const pane = map.getPane(MAP.DRAFTS_PANE)!;
    expect(pane).toBeDefined();
    expect(pane.querySelectorAll('path.cgis-draw-sketch')).toHaveLength(1);
  });
});
