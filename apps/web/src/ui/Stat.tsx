import { cva, cx, type VariantProps } from 'class-variance-authority';
import { forwardRef, useId, type HTMLAttributes, type ReactNode } from 'react';

const wholeFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
const hundredthsFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
const smallFormat = new Intl.NumberFormat(undefined, { maximumSignificantDigits: 3 });

/** User-locale number: whole from 1,000 (22,072), hundredths from 1 (12.35), else 3 significant digits (0.00421). */
export function formatStatValue(value: number): string {
  const magnitude = Math.abs(value);
  if (magnitude >= 1000) return wholeFormat.format(value);
  if (magnitude >= 1) return hundredthsFormat.format(value);
  return smallFormat.format(value);
}

export const statValueVariants = cva('font-semibold text-fg tabular-nums', {
  variants: {
    size: {
      md: 'text-xl',
      lg: 'text-2xl',
    },
  },
  defaultVariants: { size: 'lg' },
});

export interface StatProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'children'>, VariantProps<typeof statValueVariants> {
  label: ReactNode;
  /** null renders an em dash (no value yet, e.g. fewer than 3 vertices). */
  value: number | null;
  unit?: ReactNode;
  format?: (value: number) => string;
  /**
   * Announce changes politely. Leave off for values that change on every pointer move (the live
   * readout while drawing); turn on for settled values (after save).
   */
  live?: boolean;
}

/** A labelled hero number with tabular digits, e.g. the polygon area in km². */
export const Stat = forwardRef<HTMLDivElement, StatProps>(function Stat(
  { label, value, unit, format = formatStatValue, live = false, size, className, ...rest },
  ref,
) {
  const labelId = useId();
  return (
    <div ref={ref} className={cx('flex flex-col gap-1', className)} {...rest}>
      <span id={labelId} className="text-xs font-medium text-fg-muted">
        {label}
      </span>
      <output
        aria-labelledby={labelId}
        aria-live={live ? 'polite' : 'off'}
        className="flex items-baseline gap-1"
      >
        {value === null ? (
          <>
            <span aria-hidden="true" className={statValueVariants({ size })}>
              —
            </span>
            <span className="sr-only">No value</span>
          </>
        ) : (
          <>
            <span className={statValueVariants({ size })}>{format(value)}</span>
            {unit ? <span className="text-sm text-fg-muted">{unit}</span> : null}
          </>
        )}
      </output>
    </div>
  );
});
