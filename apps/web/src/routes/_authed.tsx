import { ROUTES } from '@cgis/shared/constants';
import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';
import { useState } from 'react';
import { AppFrame, ReportSelfColor, SessionMenu } from './-components/AppFrame';

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
  // The user's presence colour, lifted from the map's room for the header chip.
  const [selfColor, setSelfColor] = useState<string | null>(null);

  return (
    <AppFrame headerEnd={<SessionMenu user={user} color={selfColor} />}>
      <ReportSelfColor value={setSelfColor}>
        <Outlet />
      </ReportSelfColor>
    </AppFrame>
  );
}
