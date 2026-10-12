import { cva, cx, type VariantProps } from 'class-variance-authority';
import { forwardRef, type HTMLAttributes } from 'react';

declare module 'react' {
  interface CSSProperties {
    /** A user's presence colour (server-assigned hex), read by the presence utilities. */
    '--presence'?: string;
  }
}

/** Up to two initials, from the first and last words of the name. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0];
  if (!first) return '?';
  const last = words.length > 1 ? words[words.length - 1] : undefined;
  const firstChar = Array.from(first)[0] ?? '';
  const lastChar = last ? (Array.from(last)[0] ?? '') : '';
  return (firstChar + lastChar).toLocaleUpperCase();
}

export const avatarVariants = cva(
  'inline-flex shrink-0 items-center justify-center rounded-full bg-(--presence)/tint font-semibold text-fg inset-ring-2 inset-ring-(--presence) select-none',
  {
    variants: {
      size: {
        sm: 'size-6 text-xs',
        md: 'size-8 text-xs',
        lg: 'size-10 text-sm',
      },
    },
    defaultVariants: { size: 'md' },
  },
);

export interface AvatarProps
  extends
    Omit<HTMLAttributes<HTMLSpanElement>, 'children' | 'color'>,
    VariantProps<typeof avatarVariants> {
  name: string;
  /** The user's presence colour as the server sends it (`PresenceUser.color`). */
  color: string;
  /** Hide from assistive tech when the name is already printed next to it. */
  decorative?: boolean;
}

/**
 * Initials in a circle ringed and tinted with the user's presence colour (the same colour as
 * their ghost polygon). The colour arrives as `--presence`; the tint alpha and ring width are
 * tokens. The text stays in the body colour, so contrast holds for every hue in both themes.
 */
export const Avatar = forwardRef<HTMLSpanElement, AvatarProps>(function Avatar(
  { name, color, size, decorative = false, className, style, ...rest },
  ref,
) {
  return (
    <span
      ref={ref}
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : name}
      aria-hidden={decorative || undefined}
      className={cx(avatarVariants({ size }), className)}
      style={{ ...style, '--presence': color }}
      {...rest}
    >
      <span aria-hidden="true">{initials(name)}</span>
    </span>
  );
});
