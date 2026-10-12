import { MAP } from '@cgis/shared';
import L from 'leaflet';

/**
 * The OpenStreetMap base layer (Web Mercator, `L.CRS.EPSG3857`). The one place it is built:
 * `MapView` adds it to a new map, and the base-layer switch builds a fresh one per switch back.
 */
export function createOsmLayer(): L.TileLayer {
  return L.tileLayer(MAP.OSM_TILE_URL, {
    attribution: MAP.OSM_ATTRIBUTION,
    maxZoom: MAP.OSM_MAX_ZOOM,
  });
}
