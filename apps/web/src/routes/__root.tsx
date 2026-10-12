import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, Outlet } from '@tanstack/react-router';
import type { SessionUser } from '../lib/session';

/** Router context: `session` is the live `useSession()` value, injected by `AppRouterProvider`. */
export type RouterContext = { queryClient: QueryClient; session: SessionUser | null };

export const Route = createRootRouteWithContext<RouterContext>()({ component: RootLayout });

function RootLayout() {
  const user = Route.useRouteContext({ select: (context) => context.session });

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-current/15 px-4 py-2">
        <h1 className="text-lg font-semibold">Collaborative GIS</h1>
        {user ? (
          <div className="flex items-center gap-3 text-sm">
            <span>{user.name}</span>
            {/* No-op until T12 wires Better Auth's signOut. */}
            <button
              type="button"
              className="rounded border border-current/30 px-3 py-1 focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              Sign out
            </button>
          </div>
        ) : null}
      </header>
      <main className="relative min-h-0 flex-1">
        <Outlet />
      </main>
    </div>
  );
}
