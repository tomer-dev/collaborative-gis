import {
  type AuthUser,
  COPY,
  ROUTES,
  type SignInRequest,
  SignInResponseSchema,
  SignOutResponseSchema,
  type SignUpRequest,
  SignUpResponseSchema,
} from '@cgis/shared';
import { apiPost, ApiRequestError } from './api';

// Better Auth's email + password endpoints over apiPost (D19: no Better Auth client). Each call
// sets or clears the httpOnly session cookie server-side; callers update the session query.

/** Creates an account and signs it in; resolves to the new user. */
export async function signUp({ email, password, name }: SignUpRequest): Promise<AuthUser> {
  const body = await apiPost(ROUTES.AUTH_SIGN_UP, { email, password, name }, SignUpResponseSchema);
  return body.user;
}

/** Signs in; resolves to the user. A wrong password rejects with a 401 `ApiRequestError`. */
export async function signIn({ email, password }: SignInRequest): Promise<AuthUser> {
  const body = await apiPost(ROUTES.AUTH_SIGN_IN, { email, password }, SignInResponseSchema);
  return body.user;
}

/** Ends the session. Better Auth answers 400 when the request carries no session cookie. */
export async function signOut(): Promise<void> {
  await apiPost(ROUTES.AUTH_SIGN_OUT, {}, SignOutResponseSchema);
}

/**
 * Text to show for a failed auth call: the server's message when the response carried an
 * `ApiError` body (Better Auth's `{ code, message }`), otherwise the generic copy.
 */
export function authErrorMessage(error: unknown): string {
  return error instanceof ApiRequestError && error.body
    ? error.body.message
    : COPY.AUTH.ERROR_GENERIC;
}
