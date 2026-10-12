import { authClient } from './auth-client';

/** The signed-in user as the SPA sees it. */
export type SessionUser = { id: string; name: string };

/** `useSession()` result. */
export type SessionState = { data: SessionUser | null; isPending: boolean };

/**
 * Current user from Better Auth's `useSession()`, or `null` when signed out. A failed check
 * also yields `null`, so the guards send the visitor to sign in.
 */
export function useSession(): SessionState {
  const { data, isPending } = authClient.useSession();
  return { data: data?.user ?? null, isPending };
}
