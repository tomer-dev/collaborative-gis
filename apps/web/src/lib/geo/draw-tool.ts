import { DRAW, LIMITS, MAP } from '@cgis/shared';
import * as L from 'leaflet';
import 'leaflet-editable';
import { closeRing, invalidReason, toLngLat } from './draw-events';
import { ringAreaKm2, type LngLat } from './geodesic';

/** `pane`: the sketch's pane, created if missing; `maxPlacedVertices`: default `LIMITS.POLYGON_MAX_PLACED_VERTICES`. */
export type PolygonDrawOptions = { pane?: string; maxPlacedVertices?: number };

export interface PolygonDraw {
  enable(): void;
  disable(): void;
  enabled(): boolean;
  getVertices(): LngLat[];
  getAreaKm2(): number;
  undo(): void;
  finish(): boolean;
  cancel(): void;
}

const isEditableClass = (value: unknown): value is L.EditableStatic => typeof value === 'function';
const isLatLng = (value: unknown): value is L.LatLng => value instanceof L.LatLng;

/** Vertex handle: an empty `HANDLE_HIT_PX` hit box; map.css draws the dot. */
const handleIcon = (first: boolean) =>
  L.divIcon({
    className: first ? 'cgis-draw-handle cgis-draw-handle--first' : 'cgis-draw-handle',
    iconSize: [MAP.HANDLE_HIT_PX, MAP.HANDLE_HIT_PX],
    html: '',
  });

/**
 * The map's Leaflet.Editable, made once from `map.options.editToolsClass`. Not `L.Editable`: the
 * bundle has one Leaflet (checked in a browser on the production build; `resolve.dedupe` changes
 * nothing), but `import * as L` is a namespace the bundler builds from Leaflet's CommonJS exports
 * before leaflet-editable adds `Editable` to them, so the namespace never has it. The plugin's
 * `L.Map.mergeOptions({ editToolsClass })` lands on the shared Map class, which the map reads.
 */
function editTools(map: L.Map): L.Editable {
  if (map.editTools) return map.editTools;
  const Tools = map.options.editToolsClass;
  if (!isEditableClass(Tools)) throw new Error('leaflet-editable is not loaded');
  const featuresLayer = L.layerGroup().addTo(map);
  map.editTools = Object.assign(new Tools(map, { featuresLayer, skipMiddleMarkers: true }), {
    createVertexIcon: () => handleIcon(false),
  });
  return map.editTools;
}

/** Polygon drawing on Leaflet.Editable, reported through the `draw:*` map events (draw-events.ts). */
export function createPolygonDraw(map: L.Map, options: PolygonDrawOptions = {}): PolygonDraw {
  const cap = options.maxPlacedVertices ?? LIMITS.POLYGON_MAX_PLACED_VERTICES;
  let layer: L.Polygon | null = null;
  let editor: L.PolygonEditor | null = null;
  let committed = false;

  const getVertices = (): LngLat[] => {
    const ring = layer?.getLatLngs()[0];
    return Array.isArray(ring) ? ring.filter(isLatLng).map(toLngLat) : [];
  };
  const changed = () => map.fire('draw:change', { vertices: getVertices() });
  const complete = () => {
    const ring = closeRing(getVertices());
    disable();
    map.fire('draw:done', { ring });
  };

  const events: L.LeafletEventHandlerFnMap = {
    'editable:drawing:click': (e) => {
      if (('vertex' in e && e.vertex) || getVertices().length < cap) return; // a handle may commit
      e.cancel();
      map.fire('draw:invalid', { reason: DRAW.MAX_VERTICES_REASON });
    },
    'editable:vertex:new': (e) => {
      const index = e.vertex.getIndex();
      if (index === 0) e.vertex.setIcon(handleIcon(true));
      map.fire('draw:vertex', { vertex: toLngLat(e.vertex.getLatLng()), index });
      changed();
    },
    'editable:vertex:dragend': changed,
    'editable:vertex:deleted': changed,
    'editable:drawing:commit': () => {
      const reason = invalidReason(getVertices());
      if (reason) map.fire('draw:invalid', { reason });
      else committed = true; // completes on drawing:end, after the plugin's own commit
    },
    'editable:drawing:end': () => committed && complete(),
  };

  function enable(): void {
    if (layer) return;
    const { pane } = options;
    if (pane && !map.getPane(pane)) map.createPane(pane);
    const style = { ...MAP.DRAFT_STYLE, ...(pane ? { pane } : {}), className: 'cgis-draw-sketch' };
    const sketch = editTools(map).startPolygon(undefined, style);
    const sketchEditor = sketch.enableEdit(map);
    editor = 'newHole' in sketchEditor ? sketchEditor : null;
    layer = sketch.on(events);
    committed = false;
  }

  function disable(): void {
    if (!layer) return;
    const sketch = layer;
    layer = editor = null;
    sketch.off(events); // first: disableEdit fires drawing:cancel / drawing:end
    sketch.disableEdit();
    map.editTools.options.featuresLayer?.removeLayer(sketch);
    sketch.remove();
  }

  return {
    enable,
    disable,
    enabled: () => layer !== null,
    getVertices,
    getAreaKm2: () => ringAreaKm2(getVertices()),
    undo: () => {
      if (editor?.drawing()) editor.pop(); // pop() keeps the first vertex
    },
    finish: () => {
      if (!layer) return false;
      const reason = invalidReason(getVertices());
      if (reason) map.fire('draw:invalid', { reason });
      else complete();
      return !reason;
    },
    cancel: () => {
      if (!layer) return;
      disable();
      map.fire('draw:cancel');
    },
  };
}
