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

type TileRange = { z: number; minX: number; maxX: number; minY: number; maxY: number };

/**
 * Quantization: the bbox is replaced by the range of OSM slippy-map tiles (the scheme behind
 * `MAP.OSM_TILE_URL`) that cover it at `floor(zoom)`. Tile indices are clamped to the grid, so the
 * poles and lng 180 fall in the edge tiles. At zoom z a tile is 360 / 2^z degrees of longitude
 * wide, so panning less than a tile keeps the same range.
 */
function tileRange([west, south, east, north]: Bbox, zoom: number): TileRange {
  const z = Math.max(0, Math.floor(zoom));
  const n = 2 ** z;
  const clamp = (i: number) => Math.min(n - 1, Math.max(0, Math.floor(i)));
  const tileX = (lng: number) => clamp((n * (lng + 180)) / 360);
  // asinh(tan φ) is the Mercator y; it stays finite at ±90°, where ln(tan φ + sec φ) can hit ln(0).
  const tileY = (lat: number) =>
    clamp((n * (1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI)) / 2);
  return { z, minX: tileX(west), maxX: tileX(east), minY: tileY(north), maxY: tileY(south) };
}

/**
 * A query-key string for the bbox at this zoom: `z/minX-maxX/minY-maxY` over its covering tiles
 * (see `tileRange`). Nearby bboxes at the same zoom share a key until the view crosses a tile
 * edge. Fetch with `quantizeBbox(bbox, zoom)`, not the raw bbox, so one key always means one
 * request and no strip of a panned view is missing from the cached result.
 */
export function bboxToKey(bbox: Bbox, zoom: number): string {
  const { z, minX, maxX, minY, maxY } = tileRange(bbox, zoom);
  return `${z}/${minX}-${maxX}/${minY}-${maxY}`;
}

/** The bbox snapped outward to the edges of its covering tiles; equal for equal `bboxToKey`. */
export function quantizeBbox(bbox: Bbox, zoom: number): Bbox {
  const { z, minX, maxX, minY, maxY } = tileRange(bbox, zoom);
  const n = 2 ** z;
  const lng = (x: number) => (x / n) * 360 - 180;
  const lat = (y: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
  return [lng(minX), lat(maxY + 1), lng(maxX + 1), lat(minY)];
}
