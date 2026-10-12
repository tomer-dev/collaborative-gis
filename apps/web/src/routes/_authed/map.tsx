import { createFileRoute } from '@tanstack/react-router';
import { MapView } from '../../components/Map';

// URL /map; the session guard lives on the parent _authed layout.
export const Route = createFileRoute('/_authed/map')({
  component: MapRoute,
});

// Fills <main> (the viewport below the top bar); MapView takes the full size of this box.
function MapRoute() {
  return (
    <div data-testid="map-root" className="absolute inset-0">
      <MapView />
    </div>
  );
}
