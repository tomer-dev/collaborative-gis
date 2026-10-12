import { cva, cx, type VariantProps } from 'class-variance-authority';
import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { focusRing } from './focus';
import type { IconComponent } from './icons';

export const buttonVariants = cva(
  [
    'inline-flex shrink-0 touch-manipulation items-center justify-center gap-2 rounded-md font-medium whitespace-nowrap select-none',
    'transition-colors duration-fast ease-standard',
    'disabled:cursor-not-allowed disabled:opacity-disabled',
    focusRing,
  ],
  {
    variants: {
      variant: {
        primary:
          'bg-primary text-primary-fg enabled:hover:bg-primary-hover enabled:active:bg-primary-active',
        secondary:
          'border border-line-control bg-bg-raised text-fg enabled:hover:bg-bg-hover enabled:active:bg-bg-active',
        ghost: 'bg-transparent text-fg enabled:hover:bg-bg-hover enabled:active:bg-bg-active',
        danger:
          'bg-danger-strong text-danger-strong-fg enabled:hover:bg-danger-strong-hover enabled:active:bg-danger-strong-active',
      },
      size: {
        sm: 'h-8 text-sm',
        md: 'h-10 text-sm',
        lg: 'h-12 text-md',
      },
      iconOnly: {
        true: '',
        false: '',
      },
    },
    compoundVariants: [
      { iconOnly: false, size: 'sm', class: 'px-3' },
      { iconOnly: false, size: 'md', class: 'px-4' },
      { iconOnly: false, size: 'lg', class: 'px-5' },
      { iconOnly: true, size: 'sm', class: 'w-8' },
      { iconOnly: true, size: 'md', class: 'w-10' },
      { iconOnly: true, size: 'lg', class: 'w-12' },
    ],
    defaultVariants: { variant: 'primary', size: 'md', iconOnly: false },
  },
);

const iconSize = { sm: 'size-4 shrink-0', md: 'size-4 shrink-0', lg: 'size-5 shrink-0' } as const;

export interface ButtonProps
  extends
    ButtonHTMLAttributes<HTMLButtonElement>,
    Omit<VariantProps<typeof buttonVariants>, 'iconOnly'> {
  /** Leading icon. Without children the button is icon-only (square) and needs `aria-label`. */
  icon?: IconComponent;
}

/** Action button: primary · secondary · ghost · danger × sm 32 / md 40 / lg 48. Defaults to `type="button"`. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant, size, icon: Icon, className, children, type = 'button', ...rest },
  ref,
) {
  const iconOnly = children === undefined || children === null || children === false;
  return (
    <button
      ref={ref}
      type={type}
      className={cx(buttonVariants({ variant, size, iconOnly }), className)}
      {...rest}
    >
      {Icon ? <Icon className={iconSize[size ?? 'md']} /> : null}
      {children}
    </button>
  );
});
