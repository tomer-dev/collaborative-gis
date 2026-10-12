import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, Outlet } from '@tanstack/react-router';
import type { SessionUser } from '../lib/session';

/** Router context: `session` is the live `useSession()` value, injected by `AppRouterProvider`. */
export type RouterContext = { queryClient: QueryClient; session: SessionUser | null };

export const Route = createRootRouteWithContext<RouterContext>()({ component: RootShell });

// Full-viewport column; the layout routes below (_authed, login) render the header and main.
function RootShell() {
  return (
    <div className="flex h-full flex-col">
      <Outlet />
    </div>
  );
}
