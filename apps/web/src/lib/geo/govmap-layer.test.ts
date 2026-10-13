import { GOVMAP } from '@cgis/shared';
import L from 'leaflet';
import { describe, expect, it } from 'vitest';
import { govmapCrs } from './govmap-crs';
import { createGovmapLayer } from './govmap-layer';

const FOUNTAIN = L.latLng(32.0779953, 34.7741951);
const WESTERN_WALL = L.latLng(31.7767, 35.2345);
const CACHE_URL = `${GOVMAP.TILE_HOST}/${GOVMAP.CACHE}`;

const layer = createGovmapLayer();

/** The tile Leaflet requests for `latLng` at `zoom`: CRS pixel ÷ tile size, floored. */
function tileUrlAt(latLng: L.LatLng, zoom: number): string {
  const { x, y } = govmapCrs.latLngToPoint(latLng, zoom).unscaleBy(layer.getTileSize()).floor();
  return layer.getTileUrl(Object.assign(L.point(x, y), { z: zoom }));
}

describe('createGovmapLayer', () => {
  // Fixtures computed in the spike and each answered 200 from the CDN (research §5.3).
  it.each([
    ['the fountain at L08', FOUNTAIN, 8, 'L08/R00004a6a/C00004063.jpg'],
    ['the fountain at L10', FOUNTAIN, 10, 'L10/R000129a8/C0001018f.jpg'],
    ['the fountain at L11', FOUNTAIN, 11, 'L11/R0002e825/C000283e6.jpg'],
    ['the Western Wall at L10', WESTERN_WALL, 10, 'L10/R00012b34/C00010390.jpg'],
    ['any Israeli point at L00', WESTERN_WALL, 0, 'L00/R0000001f/C0000001b.jpg'],
  ])('requests %s from govmap’s tile path', (_name, latLng, zoom, path) => {
    expect(tileUrlAt(latLng, zoom)).toBe(`${CACHE_URL}/${path}`);
  });

  it('writes row and column in lowercase hex (uppercase answers 403)', () => {
    const path = tileUrlAt(FOUNTAIN, 11).slice(CACHE_URL.length + 1);
    expect(path).toMatch(/^L\d{2}\/R[0-9a-f]{8}\/C[0-9a-f]{8}\.jpg$/);
  });

  it('credits the Survey of Israel', () => {
    expect(layer.getAttribution?.()).toBe(GOVMAP.ATTRIBUTION);
  });

  it('stops at the deepest published level', () => {
    expect(layer.options.maxZoom).toBe(GOVMAP.RESOLUTIONS.length - 1);
  });

  it('counts rows down from the grid origin and sends no CORS request', () => {
    // tms flips rows; crossOrigin fails every tile, the CDN sends no Access-Control-Allow-Origin.
    expect(layer.options.tms).toBe(false);
    expect(layer.options.crossOrigin).toBe(false);
  });
});
