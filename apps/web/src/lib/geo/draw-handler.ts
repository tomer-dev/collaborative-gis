import { LIMITS, MAP, PolygonSchema } from '@cgis/shared';
import * as L from 'leaflet';
import { ringAreaKm2, type LngLat } from './geodesic';
import { hasSelfIntersection } from './self-intersection';

export interface PolygonDrawOptions {
  /** Pane for the live shape and the vertex handles; created if the map lacks it. Default: Leaflet's own panes. */
  pane?: string;
  /**
   * Cap on positions in the closed ring, counted like `PolygonSchema` (closing vertex included),
   * so at most `maxVertices − 1` clicks. Default `LIMITS.POLYGON_MAX_VERTICES`.
   */
  maxVertices?: number;
}

/** Events `PolygonDraw` fires on the map. Vertices and rings are GeoJSON `[lng, lat]`. */
export interface DrawEventMap {
  'draw:vertex': L.LeafletEvent & { vertex: LngLat; index: number };
  'draw:change': L.LeafletEvent & { vertices: LngLat[] };
  'draw:done': L.LeafletEvent & { ring: LngLat[] };
  'draw:cancel': L.LeafletEvent;
  'draw:invalid': L.LeafletEvent & { reason: string };
}
export type DrawVertexEvent = DrawEventMap['draw:vertex'];
export type DrawChangeEvent = DrawEventMap['draw:change'];
export type DrawDoneEvent = DrawEventMap['draw:done'];
export type DrawInvalidEvent = DrawEventMap['draw:invalid'];

/** Typed `map.on` for the draw events; returns the matching `map.off`. */
export function onDraw<K extends keyof DrawEventMap>(
  map: L.Map,
  type: K,
  fn: (event: DrawEventMap[K]) => void,
): () => void {
  const handler = fn as unknown as L.LeafletEventHandlerFn;
  map.on(type, handler);
  return () => {
    map.off(type, handler);
  };
}

export const SELF_INTERSECTION_REASON = 'Polygon edges must not cross or touch each other';
const ARIA_LABEL =
  'Polygon drawing. Click to add a vertex, drag a vertex to move it, Enter or double-click to finish, Backspace to undo, Escape to cancel.';

/** Leaflet `LatLng` → GeoJSON `[lng, lat]`; longitudes past ±180 (a panned world copy) are wrapped back. */
export function toLngLat(latlng: L.LatLng): LngLat {
  // Wrap only when needed: wrap() always recomputes the longitude and adds float noise.
  const { lng, lat } = Math.abs(latlng.lng) > 180 ? latlng.wrap() : latlng;
  return [lng, lat];
}

/** Open vertices → closed GeoJSON ring (first vertex repeated at the end). */
export function closeRing(vertices: readonly LngLat[]): LngLat[] {
  return vertices.length ? [...vertices, vertices[0]!] : [];
}

/** Why the open vertices cannot close into a polygon (`PolygonSchema`'s first issue, then the segment check), or null. */
export function invalidReason(vertices: readonly LngLat[]): string | null {
  const ring = closeRing(vertices);
  const parsed = PolygonSchema.safeParse({ type: 'Polygon', coordinates: [ring] });
  if (!parsed.success) return parsed.error.issues[0]?.message ?? 'Invalid polygon';
  return hasSelfIntersection(ring) ? SELF_INTERSECTION_REASON : null;
}

/** Reads a CSS custom property from the app theme (index.css), with a fallback for tests. */
function themeColor(el: HTMLElement, name: string, fallback: string): string {
  return getComputedStyle(el).getPropertyValue(name).trim() || fallback;
}

/** Vertex handle: a `HANDLE_RADIUS_PX` dot centred in a `HANDLE_HIT_PX` hit box; the first one is filled ("close here"). */
function handleIcon(first: boolean): L.DivIcon {
  const r = MAP.HANDLE_RADIUS_PX;
  const hit = MAP.HANDLE_HIT_PX;
  const dot = document.createElement('span');
  dot.style.cssText = [
    'display:block',
    'box-sizing:border-box',
    `width:${2 * r}px`,
    `height:${2 * r}px`,
    `margin:${hit / 2 - r}px`,
    'border-radius:50%',
    'border:2px solid var(--color-signal, #e8590c)',
    `background:${first ? 'var(--color-signal, #e8590c)' : 'var(--color-paper, #f3efe4)'}`,
    'box-shadow:0 1px 2px rgb(0 0 0 / 0.45)',
  ].join(';');
  return L.divIcon({ className: 'cgis-draw-handle', iconSize: [hit, hit], html: dot });
}

/**
 * Hand-rolled polygon draw tool as a Leaflet `Handler` (`enable()` / `disable()`).
 *
 * Click adds a vertex, dragging a handle moves it, double-click / Enter / clicking the first
 * handle closes, Backspace removes the last vertex, Escape cancels. Keys act while the map
 * container itself has focus (enable() focuses it). Finishing or cancelling disables the
 * handler; `disable()` alone discards the sketch silently.
 */
export class PolygonDraw extends L.Handler {
  readonly options: { pane?: string; maxVertices: number };
  private readonly map: L.Map;
  private latlngs: L.LatLng[] = [];
  private handles: L.Marker[] = [];
  private group: L.LayerGroup | null = null;
  private shape: L.Polygon | null = null;
  private savedAttrs: [string, string | null][] = [];
  private restoreDoubleClickZoom = false;

  constructor(map: L.Map, options: PolygonDrawOptions = {}) {
    super(map);
    this.map = map;
    this.options = { ...options, maxVertices: options.maxVertices ?? LIMITS.POLYGON_MAX_VERTICES };
  }

  addHooks(): void {
    const { map } = this;
    const { pane } = this.options;
    const container = map.getContainer();
    if (pane && !map.getPane(pane)) map.createPane(pane);

    const color = themeColor(container, '--color-signal', '#e8590c');
    this.group = L.layerGroup().addTo(map);
    this.shape = L.polygon([], {
      ...(pane ? { pane } : {}),
      interactive: false,
      color,
      weight: 2,
      dashArray: '6 4',
      fillColor: color,
      fillOpacity: 0.12,
    }).addTo(this.group);

    map.on('click', this.onClick).on('dblclick', this.onDblClick);
    container.addEventListener('keydown', this.onKeyDown);
    this.restoreDoubleClickZoom = map.doubleClickZoom.enabled();
    map.doubleClickZoom.disable();

    const attrs: [string, string][] = [
      ['role', 'application'],
      ['aria-label', ARIA_LABEL],
      ['tabindex', '0'],
    ];
    this.savedAttrs = attrs.map(([name]) => [name, container.getAttribute(name)]);
    for (const [name, value] of attrs) container.setAttribute(name, value);
    L.DomUtil.addClass(container, 'leaflet-crosshair');
    container.focus({ preventScroll: true });
  }

  removeHooks(): void {
    const { map } = this;
    const container = map.getContainer();
    map.off('click', this.onClick).off('dblclick', this.onDblClick);
    container.removeEventListener('keydown', this.onKeyDown);
    if (this.restoreDoubleClickZoom) map.doubleClickZoom.enable();
    for (const [name, value] of this.savedAttrs) {
      if (value === null) container.removeAttribute(name);
      else container.setAttribute(name, value);
    }
    L.DomUtil.removeClass(container, 'leaflet-crosshair');

    this.group?.remove();
    this.group = null;
    this.shape = null;
    this.handles = [];
    this.latlngs = [];
  }

  /** Current open vertices as GeoJSON `[lng, lat]` (empty when not drawing). */
  getVertices(): LngLat[] {
    return this.latlngs.map(toLngLat);
  }

  /** Live area of the sketch in km² (0 below 3 vertices), for the T11b readout. */
  getAreaKm2(): number {
    return ringAreaKm2(this.getVertices());
  }

  /** Adds a vertex (what a map click does). Fires `draw:invalid` at the vertex cap. */
  addVertex(latlng: L.LatLngExpression): void {
    if (!this.group) return;
    const { maxVertices } = this.options;
    if (this.latlngs.length >= maxVertices - 1) {
      this.map.fire('draw:invalid', { reason: `A ring may have at most ${maxVertices} vertices` });
      return;
    }
    const ll = L.latLng(latlng);
    const index = this.latlngs.push(ll) - 1;
    this.handles.push(this.addHandle(ll, index));
    this.map.fire('draw:vertex', { vertex: toLngLat(ll), index });
    this.changed();
  }

  /** Removes the last vertex (Backspace). */
  undo(): void {
    if (!this.latlngs.length) return;
    this.latlngs.pop();
    this.handles.pop()?.remove();
    this.changed();
  }

  /** Closes the ring (Enter / double-click): `draw:done` and disable, or `draw:invalid` and keep drawing. */
  finish(): boolean {
    if (!this.group) return false;
    const vertices = this.getVertices();
    const reason = invalidReason(vertices);
    if (reason) {
      this.map.fire('draw:invalid', { reason });
      return false;
    }
    this.disable();
    this.map.fire('draw:done', { ring: closeRing(vertices) });
    return true;
  }

  /** Discards the sketch (Escape): disable, then `draw:cancel`. */
  cancel(): void {
    if (!this.group) return;
    this.disable();
    this.map.fire('draw:cancel');
  }

  private addHandle(latlng: L.LatLng, index: number): L.Marker {
    const { pane } = this.options;
    const marker = L.marker(latlng, {
      ...(pane ? { pane } : {}),
      icon: handleIcon(index === 0),
      draggable: true,
      keyboard: false, // the container owns the keyboard; 1,000 tab stops would be unusable
    });
    marker.on('drag', () => {
      this.latlngs[index] = marker.getLatLng();
      this.changed();
    });
    // Markers do not bubble mouse events to the map, so handles close the ring themselves.
    marker.on('dblclick', () => this.finish());
    marker.on('click', () => {
      if (index === 0 && this.latlngs.length >= 3) this.finish();
    });
    return marker.addTo(this.group!);
  }

  private changed(): void {
    this.shape?.setLatLngs(this.latlngs);
    this.map.fire('draw:change', { vertices: this.getVertices() });
  }

  private readonly onClick = (e: L.LeafletMouseEvent) => this.addVertex(e.latlng);

  private readonly onDblClick = () => {
    this.finish();
  };

  private readonly onKeyDown = (e: KeyboardEvent) => {
    // Only when the container itself is focused: Enter on a zoom button must still zoom.
    if (e.target !== this.map.getContainer()) return;
    if (e.key === 'Enter') this.finish();
    else if (e.key === 'Escape') this.cancel();
    else if (e.key === 'Backspace') this.undo();
    else return;
    e.preventDefault();
  };
}
