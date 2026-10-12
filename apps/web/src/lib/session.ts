import { type GetSessionResponse, GetSessionResponseSchema, ROUTES } from '@cgis/shared';
import { queryOptions, useQuery } from '@tanstack/react-query';
import { apiGet } from './api';

/** The signed-in user as the SPA sees it: `{ id: string; name: string }`. */
export type SessionUser = NonNullable<GetSessionResponse>['user'];

/** `useSession()` result; T12 keeps this shape when it swaps in Better Auth's client. */
export type SessionState = { data: SessionUser | null; isPending: boolean };

async function fetchSession(): Promise<SessionUser | null> {
  const body = await apiGet(`${ROUTES.AUTH}/get-session`, GetSessionResponseSchema);
  return body?.user ?? null;
}

/** Query for the current session; invalidate or set it after sign-in and sign-out. */
export const sessionQuery = queryOptions({ queryKey: ['session'], queryFn: fetchSession });

/**
 * Current user, or `null` when signed out. A failed or malformed check also yields `null`,
 * so the guards send the visitor to sign in instead of rendering a protected page.
 */
export function useSession(): SessionState {
  const { data, isPending } = useQuery(sessionQuery);
  return { data: data ?? null, isPending };
}
