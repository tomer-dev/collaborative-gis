import type { QueryClient } from '@tanstack/react-query';
import {
  createBrowserHistory,
  createRouter,
  RouterProvider,
  type RouterHistory,
} from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import { useSession } from './lib/session';
import { routeTree } from './routeTree.gen';

export type { RouterContext } from './routes/__root';

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
 * Must sit inside a QueryClientProvider.
 */
export function AppRouterProvider({ router }: { router: AppRouter }) {
  const session = useSession();
  const userId = session.data?.id ?? null;
  const lastUserId = useRef(userId);

  useEffect(() => {
    if (lastUserId.current === userId) return;
    lastUserId.current = userId;
    void router.invalidate();
  }, [router, userId]);

  if (session.isPending) {
    return (
      <p role="status" className="grid h-full place-items-center text-sm">
        Checking your session…
      </p>
    );
  }
  return <RouterProvider router={router} context={{ session: session.data }} />;
}
