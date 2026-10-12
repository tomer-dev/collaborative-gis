import { DRAW, PolygonSchema, PositionSchema } from '@cgis/shared';
import type * as L from 'leaflet';
import { z } from 'zod';
import { closeRing, type LngLat } from './geodesic';
import { hasSelfIntersection } from './self-intersection';

export { closeRing };

/** Payload schemas of the draw tool's map events; positions are GeoJSON `[lng, lat]`. */
const drawEventSchemas = {
  'draw:vertex': z.object({ vertex: PositionSchema, index: z.number().int().nonnegative() }),
  'draw:change': z.object({ vertices: z.array(PositionSchema) }),
  'draw:done': z.object({ ring: z.array(PositionSchema) }),
  'draw:cancel': z.object({}),
  'draw:invalid': z.object({ reason: z.string() }),
};
type DrawPayloads = { [K in keyof typeof drawEventSchemas]: z.infer<(typeof drawEventSchemas)[K]> };
/** The schemas behind a plain `parse` per key, so a generic `K` yields `DrawPayloads[K]`. */
const schemaFor: { [K in keyof DrawPayloads]: { parse(data: unknown): DrawPayloads[K] } } =
  drawEventSchemas;

export type DrawEventType = keyof DrawPayloads;
export type DrawEvent<K extends DrawEventType> = L.LeafletEvent & DrawPayloads[K];

/**
 * Typed `map.on` for a draw event; returns the matching `map.off`. The payload is parsed, so a
 * malformed one (a bug: only our code fires these) throws a `ZodError` out of `map.fire`.
 */
export function onDraw<K extends DrawEventType>(
  map: L.Map,
  type: K,
  fn: (event: DrawEvent<K>) => void,
): () => void {
  const handler = (e: L.LeafletEvent) => fn({ ...e, ...schemaFor[type].parse(e) });
  map.on(type, handler);
  return () => {
    map.off(type, handler);
  };
}

/** `LatLng` → `[lng, lat]`; only longitudes past ±180 are wrapped (wrap() adds float noise). */
export function toLngLat(latlng: L.LatLng): LngLat {
  const { lng, lat } = Math.abs(latlng.lng) > 180 ? latlng.wrap() : latlng;
  return [lng, lat];
}

/** Why the vertices cannot close into a polygon (`PolygonSchema`'s first issue, then crossings), or null. */
export function invalidReason(vertices: readonly LngLat[]): string | null {
  const ring = closeRing(vertices);
  const parsed = PolygonSchema.safeParse({ type: 'Polygon', coordinates: [ring] });
  if (!parsed.success) return parsed.error.issues[0]!.message; // a failed parse has ≥1 issue
  return hasSelfIntersection(ring) ? DRAW.SELF_INTERSECTION_REASON : null;
}
