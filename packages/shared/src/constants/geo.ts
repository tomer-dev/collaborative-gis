/** Spatial reference of every stored geometry, and the sphere for client-side measurements. */
export const GEO = {
  /** WGS 84 lng/lat: the `geometry(Polygon,4326)` columns, bbox envelopes, and GeoJSON's default. */
  SRID: 4326,
  /**
   * WGS 84 mean radius R1 = (2a + b) / 3, in metres: the sphere `@turf/area` measures on. Against
   * the server's spheroidal `ST_Area(geography)` it reads +0.13 % at 29°N, +0.07 % at 32°N,
   * +0.03 % at 34°N (Israel), +0.45 % at the equator and −0.56 % at 60°N.
   */
  EARTH_RADIUS_M: 6371008.8,
} as const;
