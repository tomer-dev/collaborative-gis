import { z } from 'zod';

/** Every `ApiError.code` the API sends (`apps/api/src/errors.ts` maps HTTP statuses onto these). */
export const ApiErrorCodeSchema = z.enum([
  'BAD_REQUEST',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'UNPROCESSABLE',
  'PAYLOAD_TOO_LARGE',
  'RATE_LIMITED',
  'TIMEOUT',
  'NOT_READY',
  'INTERNAL',
]);
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;

export const ApiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;
