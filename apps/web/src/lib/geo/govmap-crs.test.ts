import { GOVMAP } from '@cgis/shared';
import L from 'leaflet';
import { afterEach, describe, expect, it } from 'vitest';
import { govmapCrs } from './govmap-crs';
import { wgs84ToItm } from './projection';

/** OSM way 1019049226, the Dizengoff fountain: the spike's alignment point (research §2.3, §5). */
const FOUNTAIN = L.latLng(32.0779953, 34.7741951);
const TILE_PX = 256;

describe('govmapCrs', () => {
  let map: L.Map | undefined;
  afterEach(() => {
    map?.remove();
    map = undefined;
  });

  it('is built by Proj4Leaflet on the Leaflet instance the app imports', () => {
    expect(L.Proj.CRS).toBeTypeOf('function');
    expect(govmapCrs).toBeInstanceOf(L.Proj.CRS);
    expect(govmapCrs.transformation).toBeInstanceOf(L.Transformation);
    expect(govmapCrs.code).toBe(GOVMAP.EPSG);
  });

  it('measures metres on the Earth sphere, so map.distance() and L.Circle radii stay metric', () => {
    // Circle._project takes its metric branch only when crs.distance === L.CRS.Earth.distance.
    expect(govmapCrs.distance).toBe(L.CRS.Earth.distance);
  });

  it('neither wraps longitude nor runs unbounded', () => {
    // A [-180, 180] wrapLng collapses tile columns (lon ±180 project to one tmerc x).
    expect(govmapCrs.wrapLng).toBeUndefined();
    expect(govmapCrs.infinite).toBe(false);
    expect(govmapCrs.getProjectedBounds(0)).not.toBeNull();
  });

  it('has one zoom per published resolution', () => {
    GOVMAP.RESOLUTIONS.forEach((resolution, zoom) => {
      expect(govmapCrs.scale(zoom)).toBe(1 / resolution);
      expect(govmapCrs.zoom(1 / resolution)).toBe(zoom);
    });
  });

  it('projects with the same transform as wgs84ToItm', () => {
    const { x, y } = govmapCrs.project(FOUNTAIN);
    const [itmX, itmY] = wgs84ToItm([FOUNTAIN.lng, FOUNTAIN.lat]);
    expect(x).toBeCloseTo(itmX, 6);
    expect(y).toBeCloseTo(itmY, 6);
  });

  it('places the fountain in govmap tile column 164838, row 190501 at L11', () => {
    const tile = govmapCrs.latLngToPoint(FOUNTAIN, 11).divideBy(TILE_PX).floor();
    expect([tile.x, tile.y]).toEqual([164838, 190501]);
  });

  it('round-trips a pixel back to the same lat/lng', () => {
    const back = govmapCrs.pointToLatLng(govmapCrs.latLngToPoint(FOUNTAIN, 11), 11);
    expect(back.lat).toBeCloseTo(FOUNTAIN.lat, 8);
    expect(back.lng).toBeCloseTo(FOUNTAIN.lng, 8);
  });

  it('drives a Leaflet map: centre kept, distances in metres', () => {
    map = L.map(document.createElement('div'), { crs: govmapCrs, center: FOUNTAIN, zoom: 8 });
    expect(map.getCenter().lat).toBeCloseTo(FOUNTAIN.lat, 8);
    expect(map.getCenter().lng).toBeCloseTo(FOUNTAIN.lng, 8);
    const east = L.latLng(FOUNTAIN.lat, FOUNTAIN.lng + 0.01);
    expect(map.distance(FOUNTAIN, east)).toBe(L.CRS.Earth.distance(FOUNTAIN, east));
  });
});
