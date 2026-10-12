import { createFileRoute } from '@tanstack/react-router';
import type * as L from 'leaflet';
import { useState } from 'react';
import { DrawControl } from '../../components/DrawControl';
import { MapView } from '../../components/Map';

// URL /map; the session guard lives on the parent _authed layout.
export const Route = createFileRoute('/_authed/map')({
  component: MapRoute,
});

// Fills <main> (the viewport below the top bar); MapView takes the full size of this box.
// The draw control is a sibling of the map container, so its clicks never reach the map.
function MapRoute() {
  // The latest map MapView created (StrictMode creates two in dev and removes the first).
  const [map, setMap] = useState<L.Map | null>(null);
  return (
    <div data-testid="map-root" className="absolute inset-0">
      <MapView onReady={setMap} />
      {map && <DrawControl map={map} onDone={ignoreRing} />}
    </div>
  );
}

// Placeholder until T13's save dialog takes the finished ring.
function ignoreRing() {}
