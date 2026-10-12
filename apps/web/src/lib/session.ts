import { type GetSessionResponse, GetSessionResponseSchema, QUERY, ROUTES } from '@cgis/shared';
import { type QueryClient, queryOptions, useQuery } from '@tanstack/react-query';
import { apiGet } from './api';

/** The signed-in user as the SPA sees it: `{ id: string; name: string }`. */
export type SessionUser = NonNullable<GetSessionResponse>['user'];

/** `useSession()` result. */
export type SessionState = { data: SessionUser | null; isPending: boolean };

async function fetchSession(): Promise<SessionUser | null> {
  const body = await apiGet(ROUTES.AUTH_GET_SESSION, GetSessionResponseSchema);
  return body?.user ?? null;
}

/** Query for the current session; write it with `setSession`, re-read it with `refreshSession`. */
export const sessionQuery = queryOptions({
  queryKey: ['session'],
  queryFn: fetchSession,
  // A failed check counts as signed out: send the visitor to /login now, not after retries.
  retry: QUERY.SESSION_RETRY,
});

/**
 * Current user, or `null` when signed out. A failed or malformed check also yields `null`,
 * so the guards send the visitor to sign in instead of rendering a protected page.
 */
export function useSession(): SessionState {
  const { data, isPending } = useQuery(sessionQuery);
  return { data: data ?? null, isPending };
}

/**
 * Stores the session an auth call returned: the user after sign-in or sign-up, `null` after
 * sign-out. `AppRouterProvider` sees the change and re-runs the route guards, which navigate
 * (/login and /register to /map, _authed to /login), so the guard never reads a stale session.
 */
export function setSession(queryClient: QueryClient, user: SessionUser | null): void {
  queryClient.setQueryData(sessionQuery.queryKey, user);
}

/** Re-reads the session from the server, e.g. after a failed sign-out left it unknown. */
export function refreshSession(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: sessionQuery.queryKey });
}
