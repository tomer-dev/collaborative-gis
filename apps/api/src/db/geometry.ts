import type { Polygon } from '@cgis/shared';
import { sql } from 'drizzle-orm';
import { customType } from 'drizzle-orm/pg-core';

/** WGS 84 longitude/latitude: the SRID of every stored geometry (and of GeoJSON). */
export const SRID = 4326;

/**
 * A `geometry(Polygon,4326)` column holding a GeoJSON `Polygon` ([lng, lat] positions).
 *
 * drizzle-orm 0.45's built-in `geometry()` is point-only: whatever `type`/`srid` it is given, its SQL
 * type is `geometry(point)` and it writes `point(x y)`. So polygons use this custom type instead.
 * Writes go through `ST_GeomFromGeoJSON`, whose SRID is 4326 for GeoJSON; reads parse the hex EWKB
 * that node-postgres returns for geometry columns.
 */
export const polygon = customType<{ data: Polygon; driverData: string }>({
  dataType: () => `geometry(Polygon,${SRID})`,
  toDriver: (value) => sql`ST_GeomFromGeoJSON(${JSON.stringify(value)})`,
  fromDriver: (value) => polygonFromEwkb(value),
});

const WKB_POLYGON = 3;
const EWKB_SRID_FLAG = 0x20000000;
const EWKB_Z_FLAG = 0x80000000;
const EWKB_M_FLAG = 0x40000000;

/** Parses a 2D single-ring polygon from hex (E)WKB; anything else is a bug upstream, so it throws. */
export function polygonFromEwkb(hex: string): Polygon {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  const view = new DataView(bytes.buffer);
  const little = view.getUint8(0) === 1;
  const type = view.getUint32(1, little);
  let offset = type & EWKB_SRID_FLAG ? 9 : 5; // byte order + type [+ SRID]
  const u32 = () => {
    const value = view.getUint32(offset, little);
    offset += 4;
    return value;
  };
  const f64 = () => {
    const value = view.getFloat64(offset, little);
    offset += 8;
    return value;
  };

  const rings = u32();
  if ((type & 0xffff) !== WKB_POLYGON || type & (EWKB_Z_FLAG | EWKB_M_FLAG) || rings !== 1) {
    throw new Error(
      `expected a 2D polygon with one ring, got WKB type ${type} with ${rings} rings`,
    );
  }
  const ring = Array.from({ length: u32() }, (): [number, number] => [f64(), f64()]);
  return { type: 'Polygon', coordinates: [ring] };
}
