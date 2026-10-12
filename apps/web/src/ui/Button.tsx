import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cx } from './cx';
import { focusRing } from './focus';
import type { IconComponent } from './icons';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

const base = cx(
  'inline-flex shrink-0 touch-manipulation items-center justify-center gap-2 rounded-md font-medium whitespace-nowrap select-none',
  'transition-colors duration-fast ease-standard',
  'disabled:cursor-not-allowed disabled:opacity-disabled',
  focusRing,
);

const variantClass: Record<ButtonVariant, string> = {
  primary:
    'bg-primary text-primary-fg enabled:hover:bg-primary-hover enabled:active:bg-primary-active',
  secondary:
    'border border-line-control bg-bg-raised text-fg enabled:hover:bg-bg-hover enabled:active:bg-bg-active',
  ghost: 'bg-transparent text-fg enabled:hover:bg-bg-hover enabled:active:bg-bg-active',
  danger:
    'bg-danger-strong text-danger-strong-fg enabled:hover:bg-danger-strong-hover enabled:active:bg-danger-strong-active',
};

/** Height and text per size; padding for text buttons, a square width for icon-only ones. */
const sizeClass: Record<ButtonSize, string> = {
  sm: 'h-8 text-sm',
  md: 'h-10 text-sm',
  lg: 'h-12 text-md',
};
const paddingClass: Record<ButtonSize, string> = { sm: 'px-3', md: 'px-4', lg: 'px-5' };
const squareClass: Record<ButtonSize, string> = { sm: 'w-8', md: 'w-10', lg: 'w-12' };
const iconClass: Record<ButtonSize, string> = {
  sm: 'size-4 shrink-0',
  md: 'size-4 shrink-0',
  lg: 'size-5 shrink-0',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Leading icon. Without children the button is icon-only (square) and needs `aria-label`. */
  icon?: IconComponent;
}

/** Action button: primary · secondary · ghost · danger × sm 32 / md 40 / lg 48. Defaults to `type="button"`. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', icon: Icon, className, children, type = 'button', ...rest },
  ref,
) {
  const iconOnly = children === undefined || children === null || children === false;
  return (
    <button
      ref={ref}
      type={type}
      className={cx(
        base,
        variantClass[variant],
        sizeClass[size],
        iconOnly ? squareClass[size] : paddingClass[size],
        className,
      )}
      {...rest}
    >
      {Icon ? <Icon className={iconClass[size]} /> : null}
      {children}
    </button>
  );
});
