import type { AuthUser } from '@cgis/shared';
import { authClient } from './auth-client';

/** `useSession()` result. */
export type SessionState = { data: AuthUser | null; isPending: boolean };

/**
 * Current user from Better Auth's `useSession()`, or `null` when signed out. A failed check
 * also yields `null`, so the guards send the visitor to sign in.
 */
export function useSession(): SessionState {
  const { data, isPending } = authClient.useSession();
  return { data: data?.user ?? null, isPending };
}
