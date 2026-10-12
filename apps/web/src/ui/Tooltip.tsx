import { cva, cx, type VariantProps } from 'class-variance-authority';
import {
  cloneElement,
  forwardRef,
  useEffect,
  useId,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';

// The 8 px gap to the trigger is padding on the positioned box, not margin, so the pointer can
// travel from the trigger onto the bubble without leaving the hover area (WCAG 1.4.13).
export const tooltipVariants = cva('absolute z-tooltip w-max max-w-xs', {
  variants: {
    side: {
      top: 'bottom-full left-1/2 -translate-x-1/2 pb-2',
      bottom: 'top-full left-1/2 -translate-x-1/2 pt-2',
      left: 'top-1/2 right-full -translate-y-1/2 pr-2',
      right: 'top-1/2 left-full -translate-y-1/2 pl-2',
    },
  },
  defaultVariants: { side: 'top' },
});

type TriggerProps = { 'aria-describedby'?: string; 'aria-labelledby'?: string };

export interface TooltipProps extends VariantProps<typeof tooltipVariants> {
  content: ReactNode;
  /** One focusable element (a Button); it gets aria-describedby (or aria-labelledby) pointing here. */
  children: ReactElement<TriggerProps>;
  /**
   * `description` (default): the tooltip adds to the trigger's own name.
   * `label`: the tooltip is the trigger's name (icon-only buttons without aria-label).
   */
  relation?: 'description' | 'label';
  className?: string;
}

/**
 * WAI-APG tooltip: shows on hover and on keyboard focus, hides on blur, pointer leave and Escape.
 * It is plain text (role="tooltip"); interactive content belongs in a dialog, not here.
 */
export const Tooltip = forwardRef<HTMLSpanElement, TooltipProps>(function Tooltip(
  { content, children, side, relation = 'description', className },
  ref,
) {
  const id = useId();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  const attribute = relation === 'label' ? 'aria-labelledby' : 'aria-describedby';
  const trigger = cloneElement(children, {
    [attribute]: cx(children.props[attribute], id),
  });

  return (
    <span
      ref={ref}
      className="relative inline-flex"
      onPointerEnter={() => setOpen(true)}
      onPointerLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {trigger}
      <span hidden={!open} className={tooltipVariants({ side })}>
        <span
          role="tooltip"
          id={id}
          className={cx(
            'block rounded-sm bg-fg px-2 py-1 text-xs text-bg shadow-raised',
            className,
          )}
        >
          {content}
        </span>
      </span>
    </span>
  );
});
