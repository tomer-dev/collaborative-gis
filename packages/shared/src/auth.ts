import { z } from 'zod';
import { LIMITS } from './constants';

/** The user fields the app reads from Better Auth bodies; unknown keys are stripped. */
export const AuthUserSchema = z.object({ id: z.string(), name: z.string() });
export type AuthUser = z.infer<typeof AuthUserSchema>;

/**
 * Better Auth `GET /api/auth/get-session` body, narrowed to the fields the app reads:
 * `{ session, user }` when signed in, JSON `null` when signed out. Unknown keys are stripped.
 */
export const GetSessionResponseSchema = z.union([z.object({ user: AuthUserSchema }), z.null()]);
export type GetSessionResponse = z.infer<typeof GetSessionResponseSchema>;

/** `POST /api/auth/sign-up/email` body. Better Auth enforces the same password minimum. */
export const SignUpRequestSchema = z.object({
  name: z.string().min(1),
  email: z.email(),
  password: z.string().min(LIMITS.PASSWORD_MIN),
});
export type SignUpRequest = z.infer<typeof SignUpRequestSchema>;

/** `POST /api/auth/sign-in/email` body. No length rule: the password is checked, not set. */
export const SignInRequestSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});
export type SignInRequest = z.infer<typeof SignInRequestSchema>;

/**
 * Sign-up and sign-in 200 bodies (`{ token, user }`, sign-in adds `redirect` and `url`), narrowed
 * to the user. The session itself travels in the httpOnly cookie Better Auth sets.
 */
export const SignUpResponseSchema = z.object({ user: AuthUserSchema });
export type SignUpResponse = z.infer<typeof SignUpResponseSchema>;
export const SignInResponseSchema = z.object({ user: AuthUserSchema });
export type SignInResponse = z.infer<typeof SignInResponseSchema>;

/** `POST /api/auth/sign-out` 200 body; Better Auth also clears the session cookie. */
export const SignOutResponseSchema = z.object({ success: z.boolean() });
export type SignOutResponse = z.infer<typeof SignOutResponseSchema>;
