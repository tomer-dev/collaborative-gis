import { QUERY } from '@cgis/shared';
import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { isUnauthorized } from './api-client';
import { authClient } from './auth-client';

/**
 * A 401 from the API means the session ended elsewhere (signed out in another tab, revoked). Better
 * Auth's store does not know yet, so it is told to check again; it then holds no session and the
 * `_authed` guard sends the visitor to sign in.
 */
function onApiError(error: unknown): void {
  if (isUnauthorized(error)) authClient.$store.notify('$sessionSignal');
}

/**
 * The app's single QueryClient: every query and mutation error goes through `onApiError`, and a
 * 401 is never retried (other failures keep TanStack Query's default of `QUERY.RETRY_LIMIT`).
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    queryCache: new QueryCache({ onError: onApiError }),
    mutationCache: new MutationCache({ onError: onApiError }),
    defaultOptions: {
      queries: {
        retry: (failures, error) => !isUnauthorized(error) && failures < QUERY.RETRY_LIMIT,
      },
    },
  });
}
