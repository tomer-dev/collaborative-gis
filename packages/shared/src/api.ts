import { z } from 'zod';
import { ERROR_CODES } from './constants';

/** Every `ApiError.code` the API sends (`apps/api/src/errors.ts` maps HTTP statuses onto these). */
export const ApiErrorCodeSchema = z.enum(ERROR_CODES);
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;

export const ApiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

/** The signed-in user as both apps carry it: the session user, `c.get('user')`, the Room's user. */
export type AuthUser = { id: string; name: string };
