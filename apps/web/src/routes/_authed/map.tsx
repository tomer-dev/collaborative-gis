import { createFileRoute } from '@tanstack/react-router';

// URL /map; the session guard lives on the parent _authed layout.
export const Route = createFileRoute('/_authed/map')({
  component: MapRoute,
});

// T10 mounts the Leaflet map inside this element.
function MapRoute() {
  return <div data-testid="map-root" className="absolute inset-0" />;
}
