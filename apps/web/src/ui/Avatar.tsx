import { MAP } from '@cgis/shared';
import { cva, cx, type VariantProps } from 'class-variance-authority';
import { forwardRef, type HTMLAttributes } from 'react';

/** One class pair per presence hue (tokens.css --color-presence-1..8), in join order. */
export const PRESENCE_SLOT_CLASSES = [
  'bg-presence-1/tint inset-ring-presence-1',
  'bg-presence-2/tint inset-ring-presence-2',
  'bg-presence-3/tint inset-ring-presence-3',
  'bg-presence-4/tint inset-ring-presence-4',
  'bg-presence-5/tint inset-ring-presence-5',
  'bg-presence-6/tint inset-ring-presence-6',
  'bg-presence-7/tint inset-ring-presence-7',
  'bg-presence-8/tint inset-ring-presence-8',
] as const;

const NEUTRAL_SLOT_CLASS = 'bg-presence-none/tint inset-ring-presence-none';

/** Classes for a join-order slot (0-based); slots past MAP.PRESENCE_COLORS get the neutral hue. */
export function presenceSlotClass(slot: number | null | undefined): string {
  if (slot === null || slot === undefined || slot < 0 || slot >= MAP.PRESENCE_COLORS.length) {
    return NEUTRAL_SLOT_CLASS;
  }
  return PRESENCE_SLOT_CLASSES[slot] ?? NEUTRAL_SLOT_CLASS;
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
  'inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-fg inset-ring-2 select-none',
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
  extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'>, VariantProps<typeof avatarVariants> {
  name: string;
  /** Join-order slot (0-based) that picks the presence hue; null or past the palette = neutral. */
  colorSlot?: number | null;
  /** Hide from assistive tech when the name is already printed next to it. */
  decorative?: boolean;
}

/**
 * Initials in a circle ringed and tinted with the user's presence hue (the same hue as their ghost
 * polygon). The text stays in the body colour, so contrast holds for every hue in both themes.
 */
export const Avatar = forwardRef<HTMLSpanElement, AvatarProps>(function Avatar(
  { name, colorSlot, size, decorative = false, className, ...rest },
  ref,
) {
  return (
    <span
      ref={ref}
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : name}
      aria-hidden={decorative || undefined}
      className={cx(avatarVariants({ size }), presenceSlotClass(colorSlot), className)}
      {...rest}
    >
      <span aria-hidden="true">{initials(name)}</span>
    </span>
  );
});
