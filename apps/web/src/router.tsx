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
import { AppFrame, SessionMenuPlaceholder } from './routes/-components/AppFrame';
import { NotFound } from './routes/-components/NotFound';

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
    // An unknown path stays in the frame too, with a link back to the map.
    defaultNotFoundComponent: NotFound,
    defaultPendingMs: ROUTER.PENDING_MS,
    defaultPendingMinMs: ROUTER.PENDING_MIN_MS,
  });
}

export type AppRouter = ReturnType<typeof createAppRouter>;

/**
 * The app frame with nothing in it: what the screen shows while a route is on its way. The main
 * is map-coloured, so a remembered cold load never shows the page background before the tiles.
 * A browser signed in (the hint) keeps the session menu's box, so a map chunk slower than the
 * session answer does not drop the reserve between the checking frame and the real menu.
 */
function EmptyFrame() {
  return (
    <AppFrame
      headerEnd={readSignedInHint() ? <SessionMenuPlaceholder /> : undefined}
      mainClassName="bg-map-bg"
    >
      {null}
    </AppFrame>
  );
}

/**
 * The frame during the first session check. A browser remembered as signed in sees it empty, as
 * if the app stayed (the status is for screen readers only), with the session menu's box reserved
 * in the top bar so nothing shifts when it arrives; any other sees the status in it.
 */
function CheckingFrame({ quiet }: { quiet: boolean }) {
  return (
    // The map colour only under the empty main: text-fg is unreadable on it in dark mode.
    <AppFrame
      headerEnd={quiet ? <SessionMenuPlaceholder /> : undefined}
      mainClassName={quiet ? 'bg-map-bg' : ''}
    >
      <p role="status" className={quiet ? 'sr-only' : 'grid h-full place-items-center text-sm'}>
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
 * Until the first answer, every browser sees the app frame (the pre-mount skeleton in index.html
 * already painted it): one that was signed in last time (the stored hint) sees it empty, as if
 * the app stayed; any other sees the session status in it, never a flash of a page.
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

  if (!checked) return <CheckingFrame quiet={remembered} />;
  return <RouterProvider router={router} context={{ session: user }} />;
}
