import { DRAW, LIMITS, MAP } from '@cgis/shared';
import * as L from 'leaflet';
import { useEffect, useEffectEvent, useRef, useState, type Ref } from 'react';
import { flushSync } from 'react-dom';
import { areaReadout } from '../lib/area-readout';
import { createPolygonDraw, onDraw, ringAreaKm2, type LngLat } from '../lib/geo';
import {
  Banner,
  Button,
  IconPolygon,
  MapControl,
  MapControlButton,
  Panel,
  Stat,
  type StatProps,
} from '../ui';

export type DrawControlProps = {
  /** The map to draw on. A different map starts the control over; a sketch on the old one is dropped. */
  map: L.Map;
  /** Receives the finished ring: GeoJSON `[lng, lat]`, closed (first vertex repeated at the end). */
  onDone: (ring: LngLat[]) => void;
};

/**
 * The area Stat: `areaReadout`, the one readout rule (whole m² below `MAP.AREA_KM2_THRESHOLD`,
 * km² to 3 decimals from there up). No value below 3 vertices (area 0).
 */
function areaStat(vertices: LngLat[]): Pick<StatProps, 'value' | 'unit' | 'decimals'> {
  const km2 = ringAreaKm2(vertices);
  return km2 > 0 ? areaReadout(km2) : { ...areaReadout(0), value: null };
}

/** Placed vertices against the cap a user can reach (the closing vertex is not placed). */
const VERTEX_CAP_UNIT = `/ ${LIMITS.POLYGON_MAX_PLACED_VERTICES}`;

/**
 * Polygon draw control floating over the map's top-right corner: a "Draw polygon" toolbar
 * button, then, while drawing, the live area and vertex count with Finish / Undo / Cancel.
 * Mount it next to the map container (not inside it), so its clicks never reach the map.
 */
export function DrawControl({ map, onDone }: DrawControlProps) {
  // Keyed on the map: a new map remounts the control, so its handler and state start fresh.
  return <MapDrawControl key={L.stamp(map)} map={map} onDone={onDone} />;
}

type Sketch = { vertices: LngLat[]; invalidReason: string };
const EMPTY_SKETCH: Sketch = { vertices: [], invalidReason: '' };

function MapDrawControl({ map, onDone }: DrawControlProps) {
  // One handler per map: this component lives for exactly one map (the key above).
  const [handler] = useState(() => createPolygonDraw(map, { pane: MAP.DRAFTS_PANE }));
  const [drawing, setDrawing] = useState(false);
  const [sketch, setSketch] = useState(EMPTY_SKETCH);
  const startButton = useRef<HTMLButtonElement>(null);
  // Always the latest onDone, without resubscribing (which would disable the handler mid-sketch).
  const finished = useEffectEvent((ring: LngLat[]) => onDone(ring));

  // The panel that had focus is gone: render the start button now and put focus back on it.
  const backToIdle = () => {
    flushSync(() => setDrawing(false));
    startButton.current?.focus();
  };

  useEffect(() => {
    const unsubscribe = [
      onDraw(map, 'draw:change', ({ vertices }) => setSketch({ vertices, invalidReason: '' })),
      onDraw(map, 'draw:invalid', ({ reason }) =>
        setSketch((current) => ({ ...current, invalidReason: reason })),
      ),
      onDraw(map, 'draw:done', ({ ring }) => {
        backToIdle();
        finished(ring);
      }),
      onDraw(map, 'draw:cancel', backToIdle),
    ];
    return () => {
      for (const off of unsubscribe) off();
      handler.disable();
    };
  }, [map, handler]);

  const start = () => {
    setSketch(EMPTY_SKETCH);
    setDrawing(true);
    handler.enable();
  };

  return (
    <div className="absolute top-3 right-3 z-controls">
      {drawing ? (
        <DrawingControls
          sketch={sketch}
          onFinish={() => handler.finish()}
          onUndo={() => handler.undo()}
          onCancel={() => handler.cancel()}
        />
      ) : (
        <IdleControls ref={startButton} onStart={start} />
      )}
    </div>
  );
}

function IdleControls({ ref, onStart }: { ref: Ref<HTMLButtonElement>; onStart: () => void }) {
  return (
    <MapControl label={DRAW.TOOLBAR_LABEL}>
      <MapControlButton ref={ref} label={DRAW.START_LABEL} icon={IconPolygon} onClick={onStart} />
    </MapControl>
  );
}

type DrawingControlsProps = {
  sketch: Sketch;
  onFinish: () => void;
  onUndo: () => void;
  onCancel: () => void;
};

function DrawingControls({ sketch, onFinish, onUndo, onCancel }: DrawingControlsProps) {
  const { vertices, invalidReason } = sketch;
  return (
    <Panel
      as="section"
      variant="floating"
      title={DRAW.PANEL_TITLE}
      footer={
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="mr-auto"
            disabled={vertices.length === 0}
            onClick={onUndo}
          >
            {DRAW.UNDO_LABEL}
          </Button>
          <Button variant="secondary" size="sm" onClick={onCancel}>
            {DRAW.CANCEL_LABEL}
          </Button>
          <Button size="sm" onClick={onFinish}>
            {DRAW.FINISH_LABEL}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          <Stat label={DRAW.AREA_LABEL} size="md" {...areaStat(vertices)} />
          <Stat
            label={DRAW.VERTICES_LABEL}
            value={vertices.length}
            unit={VERTEX_CAP_UNIT}
            size="md"
          />
        </div>
        {/* Hidden, not unmounted, while there is no reason: the alert node stays in the tree. */}
        <Banner tone="danger" title={invalidReason} hidden={!invalidReason} />
      </div>
    </Panel>
  );
}
