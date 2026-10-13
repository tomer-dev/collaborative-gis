import { GOVMAP } from '@cgis/shared';
import proj4 from 'proj4';

/** An EPSG:2039 (Israeli TM Grid) position in metres: [easting, northing]. */
export type Itm = [x: number, y: number];

/** WGS 84 ⇄ EPSG:2039, datum shift included (`+towgs84` in `GOVMAP.ITM_PROJ4`). */
const itm = proj4(GOVMAP.ITM_PROJ4);

/** WGS 84 `[lng, lat]` in degrees to EPSG:2039 `[x, y]` in metres. */
export const wgs84ToItm = ([lng, lat]: readonly [lng: number, lat: number]): Itm =>
  itm.forward([lng, lat]);

/** EPSG:2039 `[x, y]` in metres to WGS 84 `[lng, lat]` in degrees. */
export const itmToWgs84 = ([x, y]: readonly [x: number, y: number]): [lng: number, lat: number] =>
  itm.inverse([x, y]);
