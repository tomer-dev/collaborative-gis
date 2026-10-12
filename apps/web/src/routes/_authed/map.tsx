import type { Area } from '@cgis/shared';
import { createFileRoute } from '@tanstack/react-router';
import type * as L from 'leaflet';
import { useState } from 'react';
import { AreaPanel } from '../../components/AreaPanel';
import { AreasLayer } from '../../components/AreasLayer';
import { ConflictDialog } from '../../components/ConflictDialog';
import { ConnectionBanner } from '../../components/ConnectionBanner';
import { DrawControl } from '../../components/DrawControl';
import { GhostPolygons } from '../../components/GhostPolygons';
import { LayerSwitch } from '../../components/LayerSwitch';
import { MapView } from '../../components/Map';
import { PresenceList } from '../../components/PresenceList';
import { SaveDialog } from '../../components/SaveDialog';
import { useAreasInBounds, type AreaEdit } from '../../lib/areas-query';
import type { LngLat } from '../../lib/geo/geodesic';
import type { Bbox } from '../../lib/map';
import { useRoom } from '../../lib/use-room';

// URL /map; the session guard lives on the parent _authed layout.
export const Route = createFileRoute('/_authed/map')({
  component: MapRoute,
});

/** What the map is doing besides showing areas; each mode has one overlay (MapOverlay). */
type MapMode =
  | { kind: 'browse' }
  /** A finished sketch waiting for a name (SaveDialog). */
  | { kind: 'draft'; ring: LngLat[] }
  /** An area picked on the map (AreaPanel). */
  | { kind: 'selected'; id: string }
  /** A rename the server refused with 409 (ConflictDialog). */
  | { kind: 'conflict'; edit: AreaEdit; current: Area };

const BROWSE: MapMode = { kind: 'browse' };
// One empty list for every render without data, so AreasLayer's diff does not re-run for nothing.
const NO_AREAS: readonly Area[] = [];

// Fills <main> (the viewport below the top bar); MapView takes the full size of this box.
// The draw control, the overlays, the presence list and the connection banner are siblings of
// the map container, so their clicks never reach the map. The room hook streams this map's draw
// events as the user's draft and brings back presence, the other users' drafts (ghosts) and area
// changes (patched into the areas query cache).
function MapRoute() {
  // The latest map MapView created (StrictMode creates two in dev and removes the first).
  const [map, setMap] = useState<L.Map | null>(null);
  const [bbox, setBbox] = useState<Bbox | null>(null);
  const [mode, setMode] = useState<MapMode>(BROWSE);
  const selfId = Route.useRouteContext({ select: (context) => context.user.id });
  const room = useRoom({ selfId, map });
  const areas = useAreasInBounds(bbox).data?.areas ?? NO_AREAS;
  const selectedId = mode.kind === 'selected' ? mode.id : null;

  return (
    <div data-testid="map-root" className="absolute inset-0">
      <MapView onReady={setMap} onBoundsChange={setBbox} />
      {map ? (
        <>
          <AreasLayer
            map={map}
            areas={areas}
            selectedId={selectedId}
            onSelect={(area) => setMode({ kind: 'selected', id: area.id })}
          />
          <DrawControl map={map} onDone={(ring) => setMode({ kind: 'draft', ring })} />
          <GhostPolygons map={map} drafts={room.drafts} users={room.users} />
          <LayerSwitch map={map} />
        </>
      ) : null}
      <MapOverlay mode={mode} setMode={setMode} areas={areas} bbox={bbox} />
      <PresenceList users={room.users} selfId={selfId} />
      <ConnectionBanner state={room.state} onRetry={room.reconnect} />
    </div>
  );
}

type MapOverlayProps = {
  mode: MapMode;
  setMode: (mode: MapMode) => void;
  areas: readonly Area[];
  bbox: Bbox | null;
};

/** The one overlay for the current mode. */
function MapOverlay({ mode, setMode, areas, bbox }: MapOverlayProps) {
  const select = (area: Area) => setMode({ kind: 'selected', id: area.id });
  const onConflict = (edit: AreaEdit, current: Area) =>
    setMode({ kind: 'conflict', edit, current });

  switch (mode.kind) {
    case 'browse':
      return null;
    case 'draft':
      return <SaveDialog ring={mode.ring} bbox={bbox} onClose={() => setMode(BROWSE)} />;
    case 'selected': {
      // From the query, so the panel follows renames and refetches; gone from view, no panel.
      const area = areas.find((candidate) => candidate.id === mode.id);
      if (!area) return null;
      return (
        <AreaPanel
          key={area.id}
          area={area}
          onClose={() => setMode(BROWSE)}
          onConflict={onConflict}
          onDeleted={() => setMode(BROWSE)}
        />
      );
    }
    case 'conflict':
      return (
        <ConflictDialog
          edit={mode.edit}
          current={mode.current}
          onResolved={select}
          onConflict={onConflict}
          onClose={() => setMode({ kind: 'selected', id: mode.edit.id })}
        />
      );
  }
}
