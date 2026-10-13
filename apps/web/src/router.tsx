import type { QueryClient } from '@tanstack/react-query';
import {
  createBrowserHistory,
  createRouter,
  RouterProvider,
  type RouterHistory,
} from '@tanstack/react-router';
import { COPY, ROUTER } from '@cgis/shared/constants';
import { useEffect, useRef, useState } from 'react';
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
    // While a route's chunk (autoCodeSplitting) loads, the frame stays: the hand-off from the
    // checking frame to the map never blanks the screen, and no navigation does either.
    defaultPendingComponent: EmptyFrame,
    defaultPendingMs: ROUTER.PENDING_MS,
    defaultPendingMinMs: ROUTER.PENDING_MIN_MS,
  });
}

export type AppRouter = ReturnType<typeof createAppRouter>;

/** The app frame with nothing in it: what the screen shows while a route is on its way. */
function EmptyFrame() {
  return <AppFrame>{null}</AppFrame>;
}

/** The empty frame during the first session check; a screen reader still hears the status. */
function CheckingFrame() {
  return (
    <AppFrame>
      <p role="status" className="sr-only">
        {COPY.AUTH.SESSION_CHECKING}
      </p>
    </AppFrame>
  );
}

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

  // For a remembered browser, the current location's route chunks (autoCodeSplitting) load during
  // the check, so the map is ready to mount at the hand-off; an unknown visitor is likely bound
  // for /login, so nothing is fetched early. No guard runs here; a failed load is the router's
  // to retry when it renders the route.
  useEffect(() => {
    if (checked || !remembered) return;
    for (const match of router.matchRoutes(router.latestLocation.pathname)) {
      void router.loadRouteChunk(router.routesById[match.routeId])?.catch(() => {});
    }
  }, [router, checked, remembered]);

  // Not before the first answer: the guards would run against the unknown (null) session and
  // send a signed-in visitor to /login. The RouterProvider's own mount load reads that first
  // answer, so only a later change of user invalidates.
  const loadedUserId = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (!checked) return;
    writeSignedInHint(userId !== null);
    if (loadedUserId.current !== undefined) void router.invalidate();
    loadedUserId.current = userId;
  }, [router, checked, userId]);

  if (!checked && remembered) return <CheckingFrame />;
  if (!checked) {
    return (
      <p role="status" className="grid h-full place-items-center text-sm">
        {COPY.AUTH.SESSION_CHECKING}
      </p>
    );
  }
  return <RouterProvider router={router} context={{ session: user }} />;
}
