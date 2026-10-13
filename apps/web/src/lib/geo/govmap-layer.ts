import { GOVMAP } from '@cgis/shared';
import L from 'leaflet';

const pad = (value: number, radix: number, digits: number) =>
  value.toString(radix).padStart(digits, '0');

/**
 * govmap's legacy ArcGIS tile cache: `<cache>/L<level>/R<row>/C<column>.jpg`, the level in decimal,
 * row and column in lowercase hex. Leaflet's tile `x` is the column and `y` the row, counted down
 * from the grid's top-left origin, so `tms` stays unset. `crossOrigin` stays unset too: the CDN
 * sends no CORS headers, so a CORS request fails every tile. Use with `govmapCrs`.
 */
export class GovmapTileLayer extends L.TileLayer {
  override getTileUrl({ x, y, z }: L.Coords): string {
    const level = pad(z, 10, GOVMAP.TILE_LEVEL_DIGITS);
    const row = pad(y, 16, GOVMAP.TILE_INDEX_HEX_DIGITS);
    const column = pad(x, 16, GOVMAP.TILE_INDEX_HEX_DIGITS);
    return `${GOVMAP.TILE_HOST}/${GOVMAP.CACHE}/L${level}/R${row}/C${column}.jpg`;
  }
}

/** The aerial base layer on `GOVMAP.CACHE`, levels L00 to the deepest published. */
export function createGovmapLayer(): GovmapTileLayer {
  return new GovmapTileLayer('', {
    attribution: GOVMAP.ATTRIBUTION,
    maxZoom: GOVMAP.RESOLUTIONS.length - 1,
  });
}
