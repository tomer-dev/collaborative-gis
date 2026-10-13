import { COPY } from '@cgis/shared/constants';
import { z } from 'zod';

// Sign-up, sign-in and sign-out are the official Better Auth client's own calls (auth-client.ts),
// which throw on an error answer. Each sets or clears the httpOnly session cookie server-side; on
// success the client refetches its session store, which `authClient.useSession()` reads.

/** A failed Better Auth call (`BetterFetchError`): `error` is the JSON body the server sent. */
const AuthFailureSchema = z.object({ error: z.object({ message: z.string().min(1) }) });

/** Text to show for a failed auth call: the server's message, else the generic copy. */
export function authErrorMessage(error: unknown): string {
  const failure = AuthFailureSchema.safeParse(error);
  return failure.success ? failure.data.error.message : COPY.AUTH.ERROR_GENERIC;
}
