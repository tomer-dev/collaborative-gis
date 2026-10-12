import type { Position } from '@cgis/shared';
import { area } from '@turf/area';

/** A GeoJSON position, `[longitude, latitude]` in degrees (the shared `Position`). */
export type LngLat = Position;

/** The ring as a closed GeoJSON ring (first position repeated at the end if it is not already). */
export function closedRing(ring: readonly LngLat[]): LngLat[] {
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (!first || !last) return [];
  return first[0] === last[0] && first[1] === last[1] ? [...ring] : [...ring, first];
}

/**
 * Area of a ring in m², via `@turf/area`: spherical excess (Chamberlain & Duquette 2007) on
 * the WGS84 mean-radius sphere, R = 6371008.8 m (= `GEO.EARTH_RADIUS_M`). Open or closed
 * rings, either orientation; fewer than 3 vertices gives 0.
 */
export function ringAreaM2(ring: readonly LngLat[]): number {
  return area({ type: 'Polygon', coordinates: [closedRing(ring)] });
}

/** `ringAreaM2` in km², the unit the UI and `area_km2` use. */
export function ringAreaKm2(ring: readonly LngLat[]): number {
  return ringAreaM2(ring) / 1e6;
}
