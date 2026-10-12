import { createFileRoute } from '@tanstack/react-router';
import type * as L from 'leaflet';
import { useState } from 'react';
import { ConnectionBanner } from '../../components/ConnectionBanner';
import { DrawControl } from '../../components/DrawControl';
import { GhostPolygons } from '../../components/GhostPolygons';
import { MapView } from '../../components/Map';
import { PresenceList } from '../../components/PresenceList';
import { useRoom } from '../../lib/use-room';

// URL /map; the session guard lives on the parent _authed layout.
export const Route = createFileRoute('/_authed/map')({
  component: MapRoute,
});

// Fills <main> (the viewport below the top bar); MapView takes the full size of this box.
// The draw control, presence list and connection banner are siblings of the map container, so
// their clicks never reach the map. The room hook streams this map's draw events as the user's
// draft and brings back presence, the other users' drafts (ghosts) and area changes.
function MapRoute() {
  // The latest map MapView created (StrictMode creates two in dev and removes the first).
  const [map, setMap] = useState<L.Map | null>(null);
  const selfId = Route.useRouteContext({ select: (context) => context.user.id });
  const room = useRoom({ selfId, map });
  return (
    <div data-testid="map-root" className="absolute inset-0">
      <MapView onReady={setMap} />
      {map && <DrawControl map={map} onDone={ignoreRing} />}
      {map && <GhostPolygons map={map} drafts={room.drafts} users={room.users} />}
      <PresenceList users={room.users} selfId={selfId} />
      <ConnectionBanner state={room.state} onRetry={room.reconnect} />
    </div>
  );
}

// Placeholder until T13's save dialog takes the finished ring.
function ignoreRing() {}
