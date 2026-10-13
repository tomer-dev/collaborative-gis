import type { QueryClient } from '@tanstack/react-query';
import {
  createBrowserHistory,
  createRouter,
  RouterProvider,
  type RouterHistory,
} from '@tanstack/react-router';
import { COPY } from '@cgis/shared/constants';
import { useEffect, useState } from 'react';
import { authClient } from './lib/auth-client';
import { routeTree } from './routeTree.gen';

/** Builds the app router; tests pass a memory history. */
export function createAppRouter(
  queryClient: QueryClient,
  history: RouterHistory = createBrowserHistory(),
) {
  return createRouter({
    routeTree,
    history,
    // `session` stays null until AppRouterProvider injects the resolved value.
    context: { queryClient, session: null },
  });
}

export type AppRouter = ReturnType<typeof createAppRouter>;

declare module '@tanstack/react-router' {
  interface Register {
    router: AppRouter;
  }
}

/**
 * Renders the router once the session is known and feeds it in as router context, so
 * `beforeLoad` guards read it. When the user changes (sign-in, sign-out, expiry) the
 * router is invalidated, which re-runs the guards on the current route.
 * Sits inside the QueryClientProvider so route components can use queries.
 */
export function AppRouterProvider({ router }: { router: AppRouter }) {
  const { data, isPending } = authClient.useSession();
  const user = data?.user ?? null;
  const userId = user?.id ?? null;
  // Better Auth marks the session pending on every refetch while it holds none (right after a
  // sign-in, for one), so only the first check shows the status; later ones keep the screen.
  const [checked, setChecked] = useState(false);
  if (!checked && !isPending) setChecked(true);

  // Not before the first answer: the guards would run against the unknown (null) session and
  // send a signed-in visitor to /login. The router loads on its own once it mounts.
  useEffect(() => {
    if (checked) void router.invalidate();
  }, [router, checked, userId]);

  if (!checked) {
    return (
      <p role="status" className="grid h-full place-items-center text-sm">
        {COPY.AUTH.SESSION_CHECKING}
      </p>
    );
  }
  return <RouterProvider router={router} context={{ session: user }} />;
}
