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
  /** `list`: rows with names and state (side panel). `stack`: overlapping avatars (top bar). */
  variant?: 'list' | 'stack';
  /** Accessible name of the list. */
  label?: string;
  /** Stack only: avatars shown before a "+N" counter. */
  max?: number;
  /** List only: text when nobody is here. */
  emptyText?: string;
}

/** Who is on the map, each with their server-assigned presence colour. */
export function PresenceList({
  users,
  selfId,
  variant = 'list',
  label = 'People on this map',
  max = 4,
  emptyText = 'Nobody else is here yet.',
  className,
  ...rest
}: PresenceListProps) {
  if (variant === 'stack') {
    const shown = users.slice(0, max);
    const hidden = users.length - shown.length;
    return (
      <ul aria-label={label} className={cx('flex items-center -space-x-2', className)} {...rest}>
        {shown.map((user) => (
          <li key={user.userId} className="flex rounded-full ring-2 ring-bg-raised">
            <Avatar
              name={user.userId === selfId ? `${user.name} (you)` : user.name}
              color={user.color}
            />
          </li>
        ))}
        {hidden > 0 ? (
          <li className="flex rounded-full ring-2 ring-bg-raised">
            <span
              role="img"
              aria-label={`${hidden} more`}
              className="inline-flex size-8 items-center justify-center rounded-full bg-bg-sunken text-xs font-semibold text-fg-muted"
            >
              <span aria-hidden="true">+{hidden}</span>
            </span>
          </li>
        ) : null}
      </ul>
    );
  }

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
