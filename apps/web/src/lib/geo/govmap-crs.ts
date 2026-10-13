import { GOVMAP } from '@cgis/shared';
// Default import: Proj4Leaflet attaches `Proj` to Leaflet's exports object, which the default
// import is; a namespace import (`import * as L`) is a copy taken before the plugin runs.
import L from 'leaflet';
import 'proj4leaflet';

const [[minX, minY], [maxX, maxY]] = GOVMAP.ITM_BOUNDS;

/**
 * EPSG:2039 on govmap's legacy tile grid: zoom N is cache level LNN. Proj4Leaflet builds the
 * transformation from `origin` and the zoom ↔ scale steps from `resolutions`, and copies
 * `L.CRS.Earth`'s `distance`. With `bounds` set it is finite and, unlike `L.CRS.Earth`, has no
 * `wrapLng`; nothing else needs overriding.
 */
export const govmapCrs = new L.Proj.CRS(GOVMAP.EPSG, GOVMAP.ITM_PROJ4, {
  origin: [...GOVMAP.ORIGIN],
  resolutions: [...GOVMAP.RESOLUTIONS],
  bounds: L.bounds([minX, minY], [maxX, maxY]),
});
