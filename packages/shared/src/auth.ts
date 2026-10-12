import { z } from 'zod';

/**
 * Better Auth `GET /api/auth/get-session` body, narrowed to the fields the app reads:
 * `{ session, user }` when signed in, JSON `null` when signed out. Unknown keys are stripped.
 */
export const GetSessionResponseSchema = z.union([
  z.object({ user: z.object({ id: z.string(), name: z.string() }) }),
  z.null(),
]);
export type GetSessionResponse = z.infer<typeof GetSessionResponseSchema>;
