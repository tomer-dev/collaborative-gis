import { ROUTES } from '@cgis/shared/constants';
import { createFileRoute, redirect } from '@tanstack/react-router';

// The map is the app; `/` only forwards there (and `/map` forwards signed-out visitors to `/login`).
export const Route = createFileRoute('/')({
  beforeLoad: () => {
    throw redirect({ to: ROUTES.APP.MAP });
  },
});
