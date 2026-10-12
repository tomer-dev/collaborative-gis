import { ROUTES } from '@cgis/shared/constants';
import { queryOptions, useQuery } from '@tanstack/react-query';

/** The signed-in user as the SPA sees it. */
export type SessionUser = { id: string; name: string };

/** `useSession()` result; T12 keeps this shape when it swaps in Better Auth's client. */
export type SessionState = { data: SessionUser | null; isPending: boolean };

/** Better Auth's `GET /get-session` body (only the fields the SPA reads): JSON `null` when signed out. */
type GetSessionResponse = { user: SessionUser } | null;

async function fetchSession(): Promise<SessionUser | null> {
  const res = await fetch(`${ROUTES.AUTH}/get-session`);
  if (!res.ok) throw new Error(`session check failed: HTTP ${res.status}`);
  const body = (await res.json()) as GetSessionResponse;
  return body ? { id: body.user.id, name: body.user.name } : null;
}

/** Query for the current session; invalidate or set it after sign-in and sign-out. */
export const sessionQuery = queryOptions({ queryKey: ['session'], queryFn: fetchSession });

/**
 * Current user, or `null` when signed out. A failed check also yields `null`, so the
 * guards send the visitor to sign in instead of rendering a protected page.
 */
export function useSession(): SessionState {
  const { data, isPending } = useQuery(sessionQuery);
  return { data: data ?? null, isPending };
}
