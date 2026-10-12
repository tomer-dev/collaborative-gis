import { redirect } from '@tanstack/react-router';
import type { RouterContext } from '../__root';

/**
 * `beforeLoad` for /login and /register, the _authed guard in reverse: a signed-in visitor goes
 * to /map. It is also what moves the user on after sign-in or sign-up: `AppRouterProvider`
 * re-runs the guards once the session query holds the user, so navigation always follows the
 * session update.
 */
export function redirectSignedIn({ context }: { context: RouterContext }): void {
  if (context.session !== null) throw redirect({ to: '/map' });
}
