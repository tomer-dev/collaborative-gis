import type { AuthUser } from '@cgis/shared';
import { COPY, ROUTES } from '@cgis/shared/constants';
import { useMutation } from '@tanstack/react-query';
import { createContext, type ReactNode, useState } from 'react';
import { authClient } from '../../lib/auth-client';
import { Avatar, Button, buttonClass, IconClose, IconMenu } from '../../ui';
import { cx } from '../../ui/cx';

type AppFrameProps = {
  /** Right side of the top bar; the `_authed` layout puts `SessionMenu` here. */
  headerEnd?: ReactNode;
  /** Extra classes on the main, e.g. `bg-map-bg` while the map is on its way. */
  mainClassName?: string;
  children: ReactNode;
};

/**
 * Top bar with the app name and the guide link, then a full-height main. Each layout route picks
 * its header content. Below `sm` the bar shows only the name and a menu button: the guide link and
 * the session menu move into a panel that slides in under the bar, so nothing is squeezed or cut.
 */
export function AppFrame({ headerEnd, mainClassName = '', children }: AppFrameProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = () => setMenuOpen(false);
  // Its own full-height column: the frame also renders outside the root route (the session check).
  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 shrink-0 items-center justify-between gap-4 border-b border-line bg-bg-raised px-3 sm:px-4">
        <h1 className="min-w-0 truncate text-lg font-semibold">{COPY.APP.NAME}</h1>
        <Button
          variant="secondary"
          size="sm"
          icon={menuOpen ? IconClose : IconMenu}
          className="sm:hidden"
          aria-label={menuOpen ? COPY.APP.MENU_CLOSE : COPY.APP.MENU_OPEN}
          aria-expanded={menuOpen}
          aria-controls="app-menu"
          onClick={() => setMenuOpen((open) => !open)}
        />
        {menuOpen ? (
          // Tap outside the panel closes it; the button above stays the keyboard way out.
          <div
            aria-hidden="true"
            className="fixed inset-x-0 top-12 bottom-0 z-dialog bg-fg/30 sm:hidden"
            onClick={closeMenu}
          />
        ) : null}
        <div
          id="app-menu"
          className={cx(
            'text-sm',
            'max-sm:fixed max-sm:top-12 max-sm:right-0 max-sm:bottom-0 max-sm:z-dialog max-sm:w-64 max-sm:max-w-[85vw] max-sm:flex-col max-sm:items-stretch max-sm:gap-4 max-sm:overflow-y-auto max-sm:border-l max-sm:border-line max-sm:bg-bg-raised max-sm:p-4',
            'sm:flex sm:shrink-0 sm:items-center sm:gap-3',
            menuOpen ? 'flex' : 'hidden sm:flex',
          )}
        >
          <a
            href={ROUTES.APP.GUIDE}
            target="_blank"
            rel="noopener"
            className={buttonClass('secondary', 'sm')}
            onClick={closeMenu}
          >
            {COPY.APP.GUIDE}
          </a>
          {headerEnd}
        </div>
      </header>
      <main className={`relative min-h-0 flex-1 ${mainClassName}`}>{children}</main>
    </div>
  );
}

/**
 * Lets the page under the top bar report the signed-in user's presence colour, which only the
 * map's room knows (the server assigns it); `null` when there is none.
 */
export const ReportSelfColor = createContext<(color: string | null) => void>(() => {});

/**
 * User chip and sign-out button for the top bar. The avatar shows once the room has given the
 * user a colour (`color`), the same one their ghost and presence row carry. After a successful sign-out Better Auth
 * refetches its session (now empty) and the _authed guard sends the visitor to /login; a
 * failed one leaves the session as it was and shows an alert.
 */
export function SessionMenu({ user, color }: { user: AuthUser; color: string | null }) {
  const signOutMutation = useMutation({ mutationFn: () => authClient.signOut() });

  return (
    <div className="flex min-w-0 items-center gap-3 text-sm max-sm:flex-col max-sm:items-stretch">
      {signOutMutation.isError ? (
        <span role="alert" className="text-danger-strong">
          {COPY.AUTH.SIGN_OUT_ERROR}
        </span>
      ) : null}
      <span className="flex min-w-0 items-center gap-3">
        {color ? <Avatar name={user.name} color={color} size="sm" decorative /> : <AvatarSlot />}
        <span className="min-w-0 truncate">{user.name}</span>
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

/** The avatar's box before the room has given the user a colour, so the bar keeps its width. */
function AvatarSlot() {
  return <span aria-hidden="true" className="size-6 shrink-0 rounded-full bg-line" />;
}

/**
 * `SessionMenu`'s box while the session is still on its way (a remembered cold load): the avatar
 * slot, a name-sized bar and the sign-out button kept invisible, so the bar does not shift when
 * the real menu takes its place. The name's true width is unknown until then; the bar is a reserve.
 */
export function SessionMenuPlaceholder() {
  return (
    <div
      aria-hidden="true"
      className="flex min-w-0 items-center gap-3 text-sm max-sm:flex-col max-sm:items-stretch"
    >
      <span className="flex min-w-0 items-center gap-3">
        <AvatarSlot />
        <span className="h-4 w-16 min-w-4 rounded-sm bg-line" />
      </span>
      <Button variant="secondary" size="sm" className="invisible">
        {COPY.AUTH.SIGN_OUT}
      </Button>
    </div>
  );
}
