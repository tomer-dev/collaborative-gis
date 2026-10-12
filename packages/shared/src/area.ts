import { z } from 'zod';
import { LIMITS } from './constants/index.ts';
import { PolygonSchema } from './geo.ts';

export const AreaSchema = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1).max(LIMITS.AREA_NAME_MAX),
  geometry: PolygonSchema,
  areaKm2: z.number().nonnegative(),
  version: z.number().int().positive(),
  createdBy: z.string(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Area = z.infer<typeof AreaSchema>;

export const AreaCreateSchema = AreaSchema.pick({ name: true, geometry: true });
export type AreaCreate = z.infer<typeof AreaCreateSchema>;

export const AreaUpdateSchema = AreaCreateSchema.extend({
  version: z.number().int().positive().max(LIMITS.VERSION_MAX),
});
export type AreaUpdate = z.infer<typeof AreaUpdateSchema>;

/** `GET /api/areas?bbox=…` response body: the live areas in the viewport. */
export const AreaListSchema = z.object({ areas: z.array(AreaSchema) });
export type AreaList = z.infer<typeof AreaListSchema>;

/** One entry of an area's edit history: the area as it stood at `version`. */
export const AreaVersionSchema = z.object({
  areaId: z.uuid(),
  version: z.number().int().min(1),
  name: z.string(),
  geometry: PolygonSchema,
  areaKm2: z.number(),
  changedBy: z.string(),
  changedAt: z.iso.datetime(),
});
export type AreaVersion = z.infer<typeof AreaVersionSchema>;

/** `GET /api/areas/:id/versions` response body: the area's saved versions, newest first. */
export const VersionsResponseSchema = z.object({ versions: z.array(AreaVersionSchema) });
export type VersionsResponse = z.infer<typeof VersionsResponseSchema>;

/** One `bbox` part: a non-empty number in [min, max] (`Number('')` would read an empty part as 0). */
const coordinate = (min: number, max: number) =>
  z.string().trim().min(1).transform(Number).pipe(z.number().min(min).max(max));

export const BoundsQuerySchema = z.object({
  bbox: z
    .string()
    .transform((s) => s.split(','))
    .pipe(
      z.tuple([
        coordinate(-180, 180),
        coordinate(-90, 90),
        coordinate(-180, 180),
        coordinate(-90, 90),
      ]),
    )
    // w < e rejects antimeridian-crossing boxes by design (fine for M0's Israel-area demo)
    .refine(([w, s, e, n]) => w < e && s < n, { error: 'bbox must be w,s,e,n with w<e and s<n' }),
  // `?zoom=` (empty) means no zoom, not zoom 0 (Number('') === 0).
  zoom: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.coerce.number().int().min(0).max(22).optional(),
  ),
});
export type BoundsQuery = z.infer<typeof BoundsQuerySchema>;

/**
 * `[west, south, east, north]` in degrees: a parsed `?bbox=w,s,e,n` (`BoundsQuery['bbox']`), the
 * map's viewport, and the bounds query's envelope.
 */
export type Bbox = readonly [west: number, south: number, east: number, north: number];
