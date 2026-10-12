import { DRAW, LIMITS, MAP, PolygonSchema, PositionSchema } from '@cgis/shared';
import * as L from 'leaflet';
import 'leaflet-editable';
import { z } from 'zod';
import { ringAreaKm2, type LngLat } from './geodesic';
import { hasSelfIntersection } from './self-intersection';

export interface PolygonDrawOptions {
  /** Pane for the sketch polygon; created if the map lacks it. Default: Leaflet's overlay pane. */
  pane?: string;
  /**
   * Cap on positions in the closed ring, counted like `PolygonSchema` (closing vertex included),
   * so at most `maxVertices − 1` placed vertices. Default `LIMITS.POLYGON_MAX_VERTICES`, i.e.
   * `LIMITS.POLYGON_MAX_PLACED_VERTICES` placed.
   */
  maxVertices?: number;
}

/** Payloads of the events `PolygonDraw` fires on the map. Vertices and rings are GeoJSON `[lng, lat]`. */
const drawEventSchemas = {
  'draw:vertex': z.object({ vertex: PositionSchema, index: z.number().int().nonnegative() }),
  'draw:change': z.object({ vertices: z.array(PositionSchema) }),
  'draw:done': z.object({ ring: z.array(PositionSchema) }),
  'draw:cancel': z.object({}),
  'draw:invalid': z.object({ reason: z.string() }),
};
type DrawPayloads = { [K in keyof typeof drawEventSchemas]: z.infer<(typeof drawEventSchemas)[K]> };
/**
 * The same schemas seen through a plain `parse` signature per key, so indexing with a generic
 * `K` yields `parse(data): DrawPayloads[K]` (Zod's own `parse` returns `output<this>`, which TS
 * cannot narrow for a generic key).
 */
const schemaFor: { [K in keyof DrawPayloads]: { parse(data: unknown): DrawPayloads[K] } } =
  drawEventSchemas;

export type DrawEventType = keyof DrawPayloads;
/** One draw event as delivered to `onDraw` listeners; works with a generic `K`. */
export type DrawEvent<K extends DrawEventType> = L.LeafletEvent & DrawPayloads[K];
export type DrawEventMap = { [K in DrawEventType]: DrawEvent<K> };
export type DrawVertexEvent = DrawEventMap['draw:vertex'];
export type DrawChangeEvent = DrawEventMap['draw:change'];
export type DrawDoneEvent = DrawEventMap['draw:done'];
export type DrawInvalidEvent = DrawEventMap['draw:invalid'];

/**
 * Typed `map.on` for the draw events; returns the matching `map.off`. The payload is parsed
 * with its schema, so a malformed event (only our own code fires these) throws a `ZodError`
 * out of `map.fire` instead of reaching `fn`.
 */
export function onDraw<K extends DrawEventType>(
  map: L.Map,
  type: K,
  fn: (event: DrawEvent<K>) => void,
): () => void {
  const handler = (e: L.LeafletEvent) => fn({ ...e, ...schemaFor[type].parse(e) });
  map.on(type, handler);
  return () => {
    map.off(type, handler);
  };
}

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
  if (!parsed.success) return parsed.error.issues[0]!.message; // a failed parse has ≥1 issue
  return hasSelfIntersection(ring) ? DRAW.SELF_INTERSECTION_REASON : null;
}

const isEditableClass = (value: unknown): value is L.EditableStatic => typeof value === 'function';
const isLatLng = (value: unknown): value is L.LatLng => value instanceof L.LatLng;
const isPolygonEditor = (editor: L.Editor): editor is L.PolygonEditor => 'newHole' in editor;

/**
 * The map's Leaflet.Editable instance, created once. The class comes from `map.options` because
 * the plugin registers `L.Editable` on the CommonJS view of Leaflet, which an ESM bundle's
 * `import * as L` does not see; `L.Map.mergeOptions` reaches the shared Map class either way.
 * Vertex handles are the plugin's own vertex markers with our icon: class `cgis-draw-handle`
 * (the token stylesheet draws it, T9b) and a `MAP.HANDLE_HIT_PX` hit box.
 */
function editTools(map: L.Map): L.Editable {
  if (map.editTools) return map.editTools;
  const Tools = map.options.editToolsClass;
  if (!isEditableClass(Tools)) throw new Error('leaflet-editable is not loaded');
  const featuresLayer = L.layerGroup().addTo(map);
  map.editTools = Object.assign(new Tools(map, { featuresLayer, skipMiddleMarkers: true }), {
    createVertexIcon: () =>
      L.divIcon({
        className: 'cgis-draw-handle',
        iconSize: [MAP.HANDLE_HIT_PX, MAP.HANDLE_HIT_PX],
        html: '',
      }),
  });
  return map.editTools;
}

/**
 * Polygon draw tool as a Leaflet `Handler` (`enable()` / `disable()`) over Leaflet.Editable.
 *
 * A map click adds a vertex, dragging a handle moves it, clicking the first or the last handle
 * commits; `finish()`, `undo()` and `cancel()` are for the draw control's buttons. A valid ring
 * removes the sketch, disables the handler and fires `draw:done`; an invalid one fires
 * `draw:invalid` and keeps the sketch (after a handle-click commit it stays editable by drag).
 * `disable()` alone discards the sketch silently.
 */
export class PolygonDraw extends L.Handler {
  readonly options: { pane?: string; maxVertices: number };
  private readonly map: L.Map;
  private readonly placedCap: number;
  private layer: L.Polygon | null = null;
  private editor: L.PolygonEditor | null = null;
  private committed = false;

  constructor(map: L.Map, options: PolygonDrawOptions = {}) {
    super(map);
    this.map = map;
    this.options = { ...options, maxVertices: options.maxVertices ?? LIMITS.POLYGON_MAX_VERTICES };
    this.placedCap =
      options.maxVertices === undefined
        ? LIMITS.POLYGON_MAX_PLACED_VERTICES
        : options.maxVertices - 1;
  }

  addHooks(): void {
    const { map } = this;
    const { pane } = this.options;
    if (pane && !map.getPane(pane)) map.createPane(pane);

    const layer = editTools(map).startPolygon(undefined, {
      ...MAP.DRAFT_STYLE,
      ...(pane ? { pane } : {}),
      className: 'cgis-draw-sketch',
    });
    const editor = layer.enableEdit(map);
    this.editor = isPolygonEditor(editor) ? editor : null;
    this.layer = layer.on(this.editableEvents);
    this.committed = false;
  }

  removeHooks(): void {
    const { layer } = this;
    if (!layer) return;
    layer.off(this.editableEvents); // first: disableEdit below fires drawing:cancel / drawing:end
    layer.disableEdit(); // also cancels an ongoing drawing
    this.map.editTools.options.featuresLayer?.removeLayer(layer);
    layer.remove();
    this.layer = null;
    this.editor = null;
  }

  /** Current open vertices as GeoJSON `[lng, lat]` (empty when not drawing). */
  getVertices(): LngLat[] {
    const ring = this.layer?.getLatLngs()[0];
    return Array.isArray(ring) ? ring.filter(isLatLng).map(toLngLat) : [];
  }

  /** Live area of the sketch in km² (0 below 3 vertices), for the readout. */
  getAreaKm2(): number {
    return ringAreaKm2(this.getVertices());
  }

  /**
   * Removes the last vertex (the draw control's Undo) through the editor's `pop()`. Only while
   * drawing, and Leaflet.Editable's `pop()` keeps the first vertex: with one vertex it is a no-op.
   */
  undo(): void {
    if (this.editor?.drawing()) this.editor.pop();
  }

  /** Closes the ring (Finish): `draw:done` and disable, or `draw:invalid` and keep drawing. */
  finish(): boolean {
    if (!this.layer) return false;
    const reason = invalidReason(this.getVertices());
    if (reason) {
      this.map.fire('draw:invalid', { reason });
      return false;
    }
    this.complete();
    return true;
  }

  /** Discards the sketch (the draw control's Cancel): disable, then `draw:cancel`. */
  cancel(): void {
    if (!this.layer) return;
    this.disable();
    this.map.fire('draw:cancel');
  }

  private complete(): void {
    const ring = closeRing(this.getVertices());
    this.disable();
    this.map.fire('draw:done', { ring });
  }

  private changed(): void {
    this.map.fire('draw:change', { vertices: this.getVertices() });
  }

  /** Vertex cap: refuse the click before Leaflet.Editable adds a vertex. Clicks on a handle pass (they may commit). */
  private readonly onDrawingClick = (e: L.CancelableEvent) => {
    if ('vertex' in e && e.vertex) return;
    if (this.getVertices().length < this.placedCap) return;
    e.cancel();
    this.map.fire('draw:invalid', { reason: DRAW.MAX_VERTICES_REASON });
  };

  private readonly onVertexNew = (e: L.VertexEvent) => {
    const vertex = toLngLat(e.vertex.getLatLng());
    this.map.fire('draw:vertex', { vertex, index: e.vertex.getIndex() });
    this.changed();
  };

  private readonly onChange = () => this.changed();

  /** A handle click committed the sketch: validate now, complete once Leaflet.Editable has ended drawing. */
  private readonly onCommit = () => {
    const reason = invalidReason(this.getVertices());
    if (reason) this.map.fire('draw:invalid', { reason });
    else this.committed = true;
  };

  private readonly onDrawingEnd = () => {
    if (this.committed) this.complete();
  };

  /** Leaflet.Editable events on the sketch layer (typed by @types/leaflet-editable's event map). */
  private readonly editableEvents: L.LeafletEventHandlerFnMap = {
    'editable:drawing:click': this.onDrawingClick,
    'editable:vertex:new': this.onVertexNew,
    'editable:vertex:dragend': this.onChange,
    'editable:vertex:deleted': this.onChange,
    'editable:drawing:commit': this.onCommit,
    'editable:drawing:end': this.onDrawingEnd,
  };
}
