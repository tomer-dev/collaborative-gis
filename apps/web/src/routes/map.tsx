import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/map')({
  // Signed-out visitors go to /login; the API still enforces auth on every call.
  beforeLoad: ({ context }) => {
    if (context.session === null) throw redirect({ to: '/login' });
  },
  component: MapRoute,
});

// T10 mounts the Leaflet map inside this element.
function MapRoute() {
  return <div data-testid="map-root" className="absolute inset-0" />;
}
