import type { PresenceUser } from '@cgis/shared';
import type { HTMLAttributes } from 'react';
import { cx } from './cx';
import { Avatar } from './Avatar';
import { IconPencil } from './icons';

export interface PresenceListProps extends Omit<HTMLAttributes<HTMLElement>, 'children'> {
  /** The room's presence list as the server sends it (each user with their colour). */
  users: PresenceUser[];
  /** The signed-in user's id; that row is labelled "(you)". */
  selfId?: string;
  /** Accessible name of the list. */
  label?: string;
  /** Text when nobody is here. */
  emptyText?: string;
}

/** Who is on the map: rows with names and state, each in their server-assigned presence colour. */
export function PresenceList({
  users,
  selfId,
  label = 'People on this map',
  emptyText = 'Nobody else is here yet.',
  className,
  ...rest
}: PresenceListProps) {
  if (users.length === 0) {
    return (
      <p className={cx('text-sm text-fg-muted', className)} {...rest}>
        {emptyText}
      </p>
    );
  }

  return (
    <ul aria-label={label} className={cx('flex flex-col', className)} {...rest}>
      {users.map((user) => (
        <li key={user.userId} className="flex h-10 items-center gap-3">
          <Avatar name={user.name} color={user.color} decorative />
          <span className="min-w-0 flex-1 truncate text-sm text-fg">
            {user.name}
            {user.userId === selfId ? <span className="text-fg-muted"> (you)</span> : null}
          </span>
          {user.state === 'drawing' ? (
            <span className="flex shrink-0 items-center gap-1 text-xs text-fg-muted">
              <IconPencil className="size-4" />
              Drawing
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
