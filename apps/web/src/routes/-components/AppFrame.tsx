import type { AuthUser } from '@cgis/shared';
import { COPY } from '@cgis/shared/constants';
import { useMutation } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { signOut } from '../../lib/auth';
import { Button } from '../../ui';

type AppFrameProps = {
  /** Right side of the top bar; the `_authed` layout puts `SessionMenu` here. */
  headerEnd?: ReactNode;
  children: ReactNode;
};

/** Top bar with the app name, then a full-height main. Each layout route picks its header content. */
export function AppFrame({ headerEnd, children }: AppFrameProps) {
  return (
    <>
      <header className="flex h-12 shrink-0 items-center justify-between gap-4 border-b border-line bg-bg-raised px-4">
        <h1 className="text-lg font-semibold">{COPY.APP.NAME}</h1>
        {headerEnd}
      </header>
      <main className="relative min-h-0 flex-1">{children}</main>
    </>
  );
}

/**
 * User chip and sign-out button for the top bar. After a successful sign-out Better Auth
 * refetches its session (now empty) and the _authed guard sends the visitor to /login; a
 * failed one leaves the session as it was and shows an alert.
 */
export function SessionMenu({ user }: { user: AuthUser }) {
  const signOutMutation = useMutation({ mutationFn: signOut });

  return (
    <div className="flex items-center gap-3 text-sm">
      {signOutMutation.isError ? (
        <span role="alert" className="text-danger-strong">
          {COPY.AUTH.SIGN_OUT_ERROR}
        </span>
      ) : null}
      <span>{user.name}</span>
      <Button
        variant="secondary"
        size="sm"
        disabled={signOutMutation.isPending}
        onClick={() => signOutMutation.mutate()}
      >
        {COPY.AUTH.SIGN_OUT}
      </Button>
    </div>
  );
}
