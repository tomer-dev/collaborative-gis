/** Spatial reference of every stored geometry. */
export const GEO = {
  /** WGS 84 lng/lat: the `geometry(Polygon,4326)` columns, bbox envelopes, and GeoJSON's default. */
  SRID: 4326,
} as const;
