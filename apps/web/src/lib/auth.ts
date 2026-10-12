import { COPY } from '@cgis/shared/constants';
import { authClient } from './auth-client';

// Sign-up, sign-in and sign-out through the official Better Auth client. Each call sets or
// clears the httpOnly session cookie server-side; on success the client refetches its own
// session store, which `useSession()` reads, so callers never write the session themselves.

export type Credentials = { email: string; password: string };
export type SignUpInput = Credentials & { name: string };

/** A Better Auth call answered with an error; `message` is the server's text or the generic copy. */
export class AuthError extends Error {
  readonly status: number;

  constructor(status: number, message: string | undefined) {
    super(message || COPY.AUTH.ERROR_GENERIC);
    this.name = 'AuthError';
    this.status = status;
  }
}

/** The error half of Better Auth's `{ data, error }` result (fields this app reads). */
type ClientError = { status: number; message?: string | undefined } | null;

// Better Auth resolves failures as `{ error }`; mutations need a rejection to enter their error state.
function throwOnError(error: ClientError): void {
  if (error) throw new AuthError(error.status, error.message);
}

/** Creates an account; Better Auth signs it in (session cookie) in the same request. */
export async function signUp({ email, password, name }: SignUpInput): Promise<void> {
  const { error } = await authClient.signUp.email({ email, password, name });
  throwOnError(error);
}

/** Signs in. A wrong password rejects with a 401 `AuthError` carrying the server's message. */
export async function signIn({ email, password }: Credentials): Promise<void> {
  const { error } = await authClient.signIn.email({ email, password });
  throwOnError(error);
}

/** Ends the session (Better Auth answers success even when the cookie was already gone). */
export async function signOut(): Promise<void> {
  const { error } = await authClient.signOut();
  throwOnError(error);
}

/** Text to show for a failed auth call: the server's message, else the generic copy. */
export function authErrorMessage(error: unknown): string {
  return error instanceof AuthError ? error.message : COPY.AUTH.ERROR_GENERIC;
}
