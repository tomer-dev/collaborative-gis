import { forwardRef, useId, type HTMLAttributes, type ReactNode } from 'react';
import { cx } from './cx';

const wholeFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
const hundredthsFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
const smallFormat = new Intl.NumberFormat(undefined, { maximumSignificantDigits: 3 });
const fixedFormats = new Map<number, Intl.NumberFormat>();

function fixedFormat(decimals: number): Intl.NumberFormat {
  let format = fixedFormats.get(decimals);
  if (!format) {
    format = new Intl.NumberFormat(undefined, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
    fixedFormats.set(decimals, format);
  }
  return format;
}

export interface StatFormatOptions {
  /** Exactly this many fraction digits (1.234, 12,345) instead of the magnitude-based steps. */
  decimals?: number | undefined;
}

/**
 * User-locale number: whole from 1,000 (22,072), hundredths from 1 (12.35), else 3 significant
 * digits (0.00421). With `decimals`, a fixed number of fraction digits at any magnitude.
 */
export function formatStatValue(value: number, { decimals }: StatFormatOptions = {}): string {
  if (decimals !== undefined) return fixedFormat(decimals).format(value);
  const magnitude = Math.abs(value);
  if (magnitude >= 1000) return wholeFormat.format(value);
  if (magnitude >= 1) return hundredthsFormat.format(value);
  return smallFormat.format(value);
}

export type StatSize = 'md' | 'lg';

const valueClass: Record<StatSize, string> = {
  md: 'font-semibold text-fg tabular-nums text-xl',
  lg: 'font-semibold text-fg tabular-nums text-2xl',
};

export interface StatProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  size?: StatSize;
  label: ReactNode;
  /** null renders an em dash (no value yet, e.g. fewer than 3 vertices). */
  value: number | null;
  unit?: ReactNode;
  /** Fixed fraction digits for the default format (see formatStatValue). */
  decimals?: number | undefined;
  /** Replaces the default format (formatStatValue) entirely; `decimals` is then ignored. */
  format?: (value: number) => string;
  /**
   * Announce changes politely. Leave off for values that change on every pointer move (the live
   * readout while drawing); turn on for settled values (after save).
   */
  live?: boolean;
}

/** A labelled hero number with tabular digits, e.g. the polygon area in km². */
export const Stat = forwardRef<HTMLDivElement, StatProps>(function Stat(
  {
    label,
    value,
    unit,
    decimals,
    format = (number: number) => formatStatValue(number, { decimals }),
    live = false,
    size = 'lg',
    className,
    ...rest
  },
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
            <span aria-hidden="true" className={valueClass[size]}>
              —
            </span>
            <span className="sr-only">No value</span>
          </>
        ) : (
          <>
            <span className={valueClass[size]}>{format(value)}</span>
            {/* The space is for text and screen readers ("12.35 km²"); the flex gap spaces it visually. */}
            {unit ? (
              <>
                {' '}
                <span className="text-sm text-fg-muted">{unit}</span>
              </>
            ) : null}
          </>
        )}
      </output>
    </div>
  );
});
