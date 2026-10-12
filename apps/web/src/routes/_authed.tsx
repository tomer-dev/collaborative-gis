import { ROUTES } from '@cgis/shared/constants';
import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';
import { AppFrame } from './-components/AppFrame';

// Pathless layout: every route under routes/_authed/ needs a session and keeps its own URL.
export const Route = createFileRoute('/_authed')({
  // Signed-out visitors go to /login; the API still enforces auth on every call.
  beforeLoad: ({ context }) => {
    if (context.session === null) throw redirect({ to: ROUTES.APP.LOGIN });
    return { user: context.session };
  },
  component: AuthedLayout,
});

function AuthedLayout() {
  const user = Route.useRouteContext({ select: (context) => context.user });

  return (
    <AppFrame
      headerEnd={
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
      }
    >
      <Outlet />
    </AppFrame>
  );
}
