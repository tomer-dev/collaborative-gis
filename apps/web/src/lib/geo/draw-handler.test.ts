import { DRAW, MAP } from '@cgis/shared';
import * as L from 'leaflet';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PolygonDraw, onDraw, type DrawEventMap } from './draw-handler';
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

const click = (lat: number, lng: number) => map.fire('click', { latlng: L.latLng(lat, lng) });
const triangle = () => {
  click(32, 35);
  click(32, 35.05);
  click(32.05, 35.05);
};
const record = <K extends keyof DrawEventMap>(type: K) => {
  const events: DrawEventMap[K][] = [];
  onDraw(map, type, (e) => events.push(e));
  return events;
};
const handles = () => container.querySelectorAll<HTMLElement>('.cgis-draw-handle');

describe('PolygonDraw', () => {
  it('suspends double-click zoom and shows a crosshair while enabled, and restores both', () => {
    const draw = new PolygonDraw(map).enable();
    expect(map.doubleClickZoom.enabled()).toBe(false);
    expect(container.classList.contains('leaflet-crosshair')).toBe(true);

    draw.disable();
    expect(map.doubleClickZoom.enabled()).toBe(true);
    expect(container.classList.contains('leaflet-crosshair')).toBe(false);
  });

  it('styles through CSS classes only: handle hit box from MAP.HANDLE_HIT_PX, first handle marked', () => {
    new PolygonDraw(map).enable();
    triangle();
    const [first, second] = handles();
    expect(first!.classList.contains('cgis-draw-handle--first')).toBe(true);
    expect(second!.classList.contains('cgis-draw-handle--first')).toBe(false);
    expect(first!.style.width).toBe(`${MAP.HANDLE_HIT_PX}px`);
    expect(first!.style.height).toBe(`${MAP.HANDLE_HIT_PX}px`);
    expect(first!.innerHTML).toBe('');
    const sketch = map.getPane('overlayPane')!.querySelector('path.cgis-draw-sketch');
    expect(sketch).not.toBeNull();
    expect(sketch!.getAttribute('stroke-width')).toBe(String(MAP.DRAFT_STYLE.weight));
  });

  it('adds a vertex per click and reports [lng, lat] vertices on draw:change', () => {
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
    expect(handles()).toHaveLength(3);
    expect(draw.getAreaKm2()).toBeCloseTo(ringAreaKm2(draw.getVertices()), 9);
    expect(draw.getAreaKm2()).toBeGreaterThan(0);
  });

  it('finish() closes 3 vertices into a closed GeoJSON ring on draw:done and stops drawing', () => {
    const done = record('draw:done');
    const draw = new PolygonDraw(map).enable();
    triangle();
    draw.finish();
    expect(done).toHaveLength(1);
    const { ring } = done[0]!;
    expect(ring).toHaveLength(4);
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    expect(ringAreaKm2(ring)).toBeGreaterThan(0);
    expect(draw.enabled()).toBe(false);
    expect(handles()).toHaveLength(0);
  });

  it('double-click closes, on the map or on a handle', () => {
    const done = record('draw:done');
    const draw = new PolygonDraw(map).enable();
    triangle();
    map.fire('dblclick', { latlng: L.latLng(32.05, 35.05) });
    expect(done).toHaveLength(1);

    draw.enable();
    triangle();
    handles()[2]!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(done).toHaveLength(2);
  });

  it('clicking the first handle closes once there are 3 vertices', () => {
    const done = record('draw:done');
    new PolygonDraw(map).enable();
    triangle();
    handles()[0]!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(done).toHaveLength(1);
  });

  it('undo() removes the last vertex', () => {
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
  });

  it('cancel(): draw:cancel, layers removed, handler disabled', () => {
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
    expect(map.getPane('overlayPane')!.querySelectorAll('path')).toHaveLength(0);
  });

  it('a bowtie does not close: draw:invalid with the self-intersection reason, drawing continues', () => {
    const invalid = record('draw:invalid');
    const done = record('draw:done');
    const draw = new PolygonDraw(map).enable();
    click(32, 35);
    click(32.05, 35.05);
    click(32, 35.05);
    click(32.05, 35);
    draw.finish();
    expect(done).toHaveLength(0);
    expect(invalid).toHaveLength(1);
    expect(invalid[0]!.reason).toBe(DRAW.SELF_INTERSECTION_REASON);
    expect(draw.enabled()).toBe(true);
    expect(draw.getVertices()).toHaveLength(4);
  });

  it('fewer than 3 vertices does not close: draw:invalid with the PolygonSchema reason', () => {
    const invalid = record('draw:invalid');
    const draw = new PolygonDraw(map).enable();
    click(32, 35);
    click(32, 35.05);
    draw.finish();
    expect(invalid).toHaveLength(1);
    expect(invalid[0]!.reason).toMatch(/at least 3 unique vertices/);
  });

  it('respects maxVertices (closed-ring positions, as PolygonSchema counts them)', () => {
    const invalid = record('draw:invalid');
    const draw = new PolygonDraw(map, { maxVertices: 4 }).enable();
    triangle();
    click(32.05, 35);
    expect(draw.getVertices()).toHaveLength(3);
    expect(invalid).toHaveLength(1);
    expect(invalid[0]!.reason).toBe(DRAW.MAX_VERTICES_REASON);
  });

  it('defaults maxVertices to LIMITS.POLYGON_MAX_VERTICES', () => {
    const draw = new PolygonDraw(map);
    expect(draw.options.maxVertices).toBe(1000);
  });

  it('dragging a handle moves its vertex and fires draw:change', () => {
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

  it('uses the requested pane for the shape and the handles, creating it if missing', () => {
    new PolygonDraw(map, { pane: MAP.DRAFTS_PANE }).enable();
    triangle();
    const pane = map.getPane(MAP.DRAFTS_PANE)!;
    expect(pane).toBeDefined();
    expect(pane.querySelectorAll('.cgis-draw-handle')).toHaveLength(3);
  });
});
