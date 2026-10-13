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
import { readSignedInHint, writeSignedInHint } from './lib/signed-in-hint';
import { routeTree } from './routeTree.gen';
import { AppFrame } from './routes/-components/AppFrame';

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
 * Until the first answer, a browser that was signed in last time (the stored hint) sees the
 * app frame, as if the app stayed; any other sees the session status, never a flash of the app.
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
  // Read once: what this browser remembered before this load's first answer rewrites it.
  const [remembered] = useState(readSignedInHint);

  // Not before the first answer: the guards would run against the unknown (null) session and
  // send a signed-in visitor to /login. The router loads on its own once it mounts.
  useEffect(() => {
    if (!checked) return;
    writeSignedInHint(userId !== null);
    void router.invalidate();
  }, [router, checked, userId]);

  if (!checked && remembered) return <AppFrame>{null}</AppFrame>;
  if (!checked) {
    return (
      <p role="status" className="grid h-full place-items-center text-sm">
        {COPY.AUTH.SESSION_CHECKING}
      </p>
    );
  }
  return <RouterProvider router={router} context={{ session: user }} />;
}
