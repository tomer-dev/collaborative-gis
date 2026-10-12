import { z } from 'zod';
import { PolygonSchema } from './geo';

export const AreaSchema = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1).max(120),
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

export const AreaUpdateSchema = AreaCreateSchema.extend({ version: z.number().int().positive() });
export type AreaUpdate = z.infer<typeof AreaUpdateSchema>;

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

export const BoundsQuerySchema = z.object({
  bbox: z
    .string()
    .transform((s) => s.split(',').map(Number))
    .pipe(
      z.tuple([
        z.number().min(-180).max(180),
        z.number().min(-90).max(90),
        z.number().min(-180).max(180),
        z.number().min(-90).max(90),
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
