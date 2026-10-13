import type { Area, Bbox } from '@cgis/shared';
import L from 'leaflet';

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

/** The OS asks for less motion: the map's zoom and fade animations and the layer crossfade are off. */
export const prefersReducedMotion = (): boolean => window.matchMedia(REDUCED_MOTION).matches;

/**
 * The map's visible bounds as a `Bbox` the API accepts. `map.getBounds()` is unbounded: on a
 * wrapped world copy, or zoomed out until the world is narrower than the container, its longitudes
 * run past ±180. `BoundsQuerySchema` requires lng in [-180, 180] and w < e, so the bounds are
 * re-centred on the primary world copy, then west/east are clamped to the CRS's `wrapLng`.
 * Latitudes need no clamp: Web Mercator never unprojects past ±85.05°.
 * A degenerate view (zero-size container) gives w === e or s === n, which the API rejects.
 */
export function boundsToBbox(map: L.Map): Bbox {
  const bounds = map.wrapLatLngBounds(map.getBounds());
  // EPSG3857 (the default CRS) wraps at [-180, 180]; a CRS without wrapLng is left unclamped.
  const [minLng, maxLng] = map.options.crs?.wrapLng ?? [-Infinity, Infinity];
  return [
    Math.max(minLng, bounds.getWest()),
    bounds.getSouth(),
    Math.min(maxLng, bounds.getEast()),
    bounds.getNorth(),
  ];
}

/** An area's bounding box in Leaflet's `[lat, lng]` order (GeoJSON rings are `[lng, lat]`). */
export function areaBounds(area: Area): L.LatLngBounds {
  return L.latLngBounds(area.geometry.coordinates[0].map(([lng, lat]) => L.latLng(lat, lng)));
}
