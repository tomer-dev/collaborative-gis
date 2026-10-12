import { GEO, type Polygon } from '@cgis/shared';
import { sql } from 'drizzle-orm';
import { customType } from 'drizzle-orm/pg-core';

/**
 * A `geometry(Polygon,GEO.SRID)` (4326) column for a GeoJSON `Polygon` ([lng, lat] positions).
 *
 * drizzle-orm 0.45's built-in `geometry()` is point-only: whatever `type`/`srid` it is given, its SQL
 * type is `geometry(point)` and it writes `point(x y)`. So polygons use this custom type instead,
 * which gives drizzle-kit the DDL type.
 *
 * Writes: the GeoJSON goes to `ST_GeomFromGeoJSON` as a bound parameter (SRID 4326, GeoJSON's
 * default). Reads: not supported. node-postgres would hand over hex EWKB, so `fromDriver` throws;
 * select `ST_AsGeoJSON(geom)::json` instead, as the helpers in ./spatial.ts do.
 */
export const polygon = customType<{ data: Polygon; driverData: string }>({
  dataType: () => `geometry(Polygon,${GEO.SRID})`,
  toDriver: (value) => sql`ST_GeomFromGeoJSON(${JSON.stringify(value)})`,
  fromDriver: () => {
    throw new Error(
      'read areas.geom through ST_AsGeoJSON(geom)::json (see spatial.ts); raw geometry reads are not supported',
    );
  },
});
