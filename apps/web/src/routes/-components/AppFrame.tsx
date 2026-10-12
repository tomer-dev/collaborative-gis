import { COPY } from '@cgis/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { signOut } from '../../lib/auth';
import { refreshSession, setSession, type SessionUser } from '../../lib/session';
import { Avatar, Button } from '../../ui';

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
 * User chip and sign-out button for the top bar. Sign-out clears the session query; the _authed
 * guard then sends the visitor to /login. If the call fails the session is re-read from the
 * server: still valid keeps the user here with an alert, already ended goes to /login.
 */
export function SessionMenu({ user }: { user: SessionUser }) {
  const queryClient = useQueryClient();
  const signOutMutation = useMutation({
    mutationFn: signOut,
    onSuccess: () => setSession(queryClient, null),
    onError: () => refreshSession(queryClient),
  });

  return (
    <div className="flex items-center gap-3 text-sm">
      {signOutMutation.isError ? (
        <span role="alert" className="text-danger-strong">
          {COPY.AUTH.SIGN_OUT_ERROR}
        </span>
      ) : null}
      <span className="flex items-center gap-2">
        <Avatar name={user.name} size="sm" decorative />
        <span>{user.name}</span>
      </span>
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
