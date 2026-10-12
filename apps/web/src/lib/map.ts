import type L from 'leaflet';

/** `[west, south, east, north]` in degrees, the order of the API's `?bbox=w,s,e,n`. */
export type Bbox = [west: number, south: number, east: number, north: number];

/**
 * The map's visible bounds as a `Bbox` the API accepts (`BoundsQuerySchema`: lng in [-180, 180]).
 * Leaflet reports longitudes past ±180 when the view sits on a wrapped world copy or is wider than
 * the world, so the bounds are first re-centred on the primary copy, then clamped to the CRS's
 * longitude range. Latitudes need no clamp: Web Mercator never unprojects past ±85.05°.
 * A degenerate view (zero-size container) gives w === e or s === n, which the API rejects.
 */
export function boundsToBbox(map: L.Map): Bbox {
  // The default CRS (EPSG3857) wraps at [-180, 180]; a CRS without wrapLng is left unclamped.
  const [minLng, maxLng] = map.options.crs?.wrapLng ?? [-Infinity, Infinity];
  const visible = map.getBounds();
  const centerLng = visible.getCenter().lng;
  // Leaflet's wrap adds float noise (34.7 -> 34.700000000000024) even to in-range bounds.
  const bounds = centerLng < minLng || centerLng > maxLng ? map.wrapLatLngBounds(visible) : visible;
  return [
    Math.max(minLng, bounds.getWest()),
    bounds.getSouth(),
    Math.min(maxLng, bounds.getEast()),
    bounds.getNorth(),
  ];
}
