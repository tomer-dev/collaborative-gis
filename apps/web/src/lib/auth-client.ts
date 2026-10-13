import { ROUTES } from '@cgis/shared/constants';
import { createAuthClient } from 'better-auth/react';

/**
 * The official Better Auth client; all auth traffic (session, sign-in/up/out) goes through it.
 * Better Auth's `baseURL` must be an absolute origin (a bare path throws "Invalid base URL"),
 * so it is omitted: the client then calls `window.location.origin` + `basePath`, which is
 * same-origin (Vite proxies /api to `wrangler dev` in development). An error answer throws a
 * `BetterFetchError` (`fetchOptions.throw`), so a mutation enters its error state; `useSession`
 * catches its own.
 */
export const authClient = createAuthClient({
  basePath: ROUTES.AUTH,
  fetchOptions: { throw: true },
});
