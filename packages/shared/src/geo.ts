import { z } from 'zod';
import { LIMITS } from './constants/index.ts';

export const PositionSchema = z.tuple([
  z.number().min(-180).max(180), // lng
  z.number().min(-90).max(90), // lat
]);
export type Position = z.infer<typeof PositionSchema>;

const RingSchema = z
  .array(PositionSchema)
  // abort: zod still runs the refinements below after a failed length check; they index r[0]
  .min(4, { error: 'A ring needs at least 3 unique vertices plus the closing vertex', abort: true })
  .max(LIMITS.POLYGON_MAX_VERTICES, {
    error: `A ring may have at most ${LIMITS.POLYGON_MAX_VERTICES} vertices`,
  })
  .refine((r) => r[0]![0] === r[r.length - 1]![0] && r[0]![1] === r[r.length - 1]![1], {
    error: 'Ring must be closed: first and last vertex must be equal',
  })
  .refine((r) => new Set(r.slice(0, -1).map((p) => `${p[0]},${p[1]}`)).size >= 3, {
    error: 'Ring needs at least 3 unique vertices',
  });

export const PolygonSchema = z.object({
  type: z.literal('Polygon'),
  coordinates: z.tuple([RingSchema]), // ponytail: outer ring only; holes are out of scope for the brief
});
export type Polygon = z.infer<typeof PolygonSchema>;
