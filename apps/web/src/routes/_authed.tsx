import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';
import { AppFrame, SessionMenu } from './-components/AppFrame';

// Pathless layout: every route under routes/_authed/ needs a session and keeps its own URL.
export const Route = createFileRoute('/_authed')({
  // Signed-out visitors go to /login; the API still enforces auth on every call.
  beforeLoad: ({ context }) => {
    if (context.session === null) throw redirect({ to: '/login' });
    return { user: context.session };
  },
  component: AuthedLayout,
});

function AuthedLayout() {
  const user = Route.useRouteContext({ select: (context) => context.user });

  return (
    <AppFrame headerEnd={<SessionMenu user={user} />}>
      <Outlet />
    </AppFrame>
  );
}
