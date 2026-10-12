import { cva, cx, type VariantProps } from 'class-variance-authority';
import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from 'react';
import { Button } from './Button';
import type { IconComponent } from './icons';

export const mapControlVariants = cva(
  'inline-flex gap-1 rounded-md border border-line bg-bg-raised p-1 text-fg shadow-raised',
  {
    variants: {
      orientation: {
        vertical: 'flex-col',
        horizontal: 'flex-row',
      },
    },
    defaultVariants: { orientation: 'vertical' },
  },
);

export interface MapControlProps
  extends
    Omit<HTMLAttributes<HTMLDivElement>, 'children'>,
    VariantProps<typeof mapControlVariants> {
  /** Accessible name of the toolbar ("Drawing tools"). */
  label: string;
  /** MapControlButtons. */
  children: ReactNode;
}

/**
 * Map toolbar: a labelled group of MapControlButtons. Each button is its own Tab stop. To place it
 * on the map, render it into a Leaflet control container (the map component owns that).
 */
export const MapControl = forwardRef<HTMLDivElement, MapControlProps>(function MapControl(
  { label, children, orientation, className, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      role="toolbar"
      aria-label={label}
      aria-orientation={orientation === 'horizontal' ? 'horizontal' : 'vertical'}
      className={cx(mapControlVariants({ orientation }), className)}
      {...rest}
    >
      {children}
    </div>
  );
});

export interface MapControlButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'children'
> {
  /** Name of the action: the button's accessible name and its native `title` hint. */
  label: string;
  icon: IconComponent;
  /** Toggle state for mode buttons (e.g. "Draw polygon"); omit for one-shot actions. */
  pressed?: boolean;
}

/** Icon-only 40 x 40 toolbar button; `label` is its aria-label and title. */
export const MapControlButton = forwardRef<HTMLButtonElement, MapControlButtonProps>(
  function MapControlButton({ label, icon, pressed, className, ...rest }, ref) {
    return (
      <Button
        ref={ref}
        variant="ghost"
        icon={icon}
        aria-label={label}
        title={label}
        aria-pressed={pressed}
        className={cx(
          'aria-pressed:bg-primary aria-pressed:text-primary-fg aria-pressed:enabled:hover:bg-primary-hover aria-pressed:enabled:active:bg-primary-active',
          className,
        )}
        {...rest}
      />
    );
  },
);
