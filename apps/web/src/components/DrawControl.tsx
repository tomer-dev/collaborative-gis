import { AREA_FORMAT, DRAW, LIMITS, MAP } from '@cgis/shared';
import * as L from 'leaflet';
import { useEffect, useEffectEvent, useState } from 'react';
import { onDraw, PolygonDraw } from '../lib/geo/draw-handler';
import { ringAreaKm2, type LngLat } from '../lib/geo/geodesic';
import { Banner, Button, IconPolygon, MapControl, MapControlButton, Panel, Stat } from '../ui';

export type DrawControlProps = {
  /** The map to draw on. A different map starts the control over; a sketch on the old one is dropped. */
  map: L.Map;
  /** Receives the finished ring: GeoJSON `[lng, lat]`, closed (first vertex repeated at the end). */
  onDone: (ring: LngLat[]) => void;
};

const m2Format = new Intl.NumberFormat(AREA_FORMAT.LOCALE, {
  maximumFractionDigits: AREA_FORMAT.M2_DECIMALS,
});
const km2Format = new Intl.NumberFormat(AREA_FORMAT.LOCALE, {
  minimumFractionDigits: AREA_FORMAT.KM2_DECIMALS,
  maximumFractionDigits: AREA_FORMAT.KM2_DECIMALS,
});

/** `12,345 m²` below `AREA_FORMAT.KM2_THRESHOLD` km², `1.234 km²` from there up. */
function formatArea(km2: number): string {
  return km2 < AREA_FORMAT.KM2_THRESHOLD
    ? `${m2Format.format(km2 * AREA_FORMAT.M2_PER_KM2)} ${AREA_FORMAT.M2_UNIT}`
    : `${km2Format.format(km2)} ${AREA_FORMAT.KM2_UNIT}`;
}

const formatVertexCount = (count: number) => `${count} / ${LIMITS.POLYGON_MAX_VERTICES}`;

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
  const [handler] = useState(() => new PolygonDraw(map, { pane: MAP.DRAFTS_PANE }));
  const [drawing, setDrawing] = useState(false);
  const [sketch, setSketch] = useState(EMPTY_SKETCH);
  // Always the latest onDone, without resubscribing (which would disable the handler mid-sketch).
  const finished = useEffectEvent((ring: LngLat[]) => onDone(ring));

  useEffect(() => {
    const unsubscribe = [
      onDraw(map, 'draw:change', ({ vertices }) => setSketch({ vertices, invalidReason: '' })),
      onDraw(map, 'draw:invalid', ({ reason }) =>
        setSketch((current) => ({ ...current, invalidReason: reason })),
      ),
      onDraw(map, 'draw:done', ({ ring }) => {
        setDrawing(false);
        finished(ring);
      }),
      onDraw(map, 'draw:cancel', () => setDrawing(false)),
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
        <IdleControls onStart={start} />
      )}
    </div>
  );
}

function IdleControls({ onStart }: { onStart: () => void }) {
  return (
    <MapControl label={DRAW.TOOLBAR_LABEL}>
      <MapControlButton
        label={DRAW.START_LABEL}
        icon={IconPolygon}
        tooltipSide="left"
        onClick={onStart}
      />
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
  const areaKm2 = ringAreaKm2(vertices);
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
          {/* ringAreaKm2 is 0 below 3 vertices: Stat shows "no value" instead of 0 m². */}
          <Stat
            label={DRAW.AREA_LABEL}
            value={areaKm2 > 0 ? areaKm2 : null}
            format={formatArea}
            size="md"
          />
          <Stat
            label={DRAW.VERTICES_LABEL}
            value={vertices.length}
            format={formatVertexCount}
            size="md"
          />
        </div>
        {/* Hidden, not unmounted, while there is no reason: the alert node stays in the tree. */}
        <Banner tone="danger" title={invalidReason} hidden={!invalidReason} />
      </div>
    </Panel>
  );
}
