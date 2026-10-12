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
    .refine(([w, s, e, n]) => w < e && s < n, { error: 'bbox must be w,s,e,n with w<e and s<n' }),
  zoom: z.coerce.number().int().min(0).max(22).optional(),
});
export type BoundsQuery = z.infer<typeof BoundsQuerySchema>;
