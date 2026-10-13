import { forwardRef, useId, type HTMLAttributes, type ReactNode } from 'react';
import { cx } from './cx';

export type PanelVariant = 'docked' | 'floating';

const base = 'flex min-h-0 w-xs max-w-full flex-col bg-bg-raised text-fg';

const variantClass: Record<PanelVariant, string> = {
  /** Full-height side panel docked to the right edge of the map. */
  docked: 'h-full border-l border-line',
  /** Card floating over the map. */
  floating: 'rounded-lg border border-line shadow-raised',
};

export interface PanelProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  variant?: PanelVariant;
  /** Heading (h2) that also names the panel's landmark. */
  title: ReactNode;
  /** Header controls, e.g. a close button. */
  actions?: ReactNode;
  footer?: ReactNode;
  /** `aside` (complementary landmark, default) or `section` (region). */
  as?: 'aside' | 'section';
  /** Extra classes for the scrolling body, e.g. `max-sm:hidden` to fold it on a phone. */
  bodyClassName?: string | undefined;
}

/** Side panel shell: titled header, scrolling body, optional footer. */
export const Panel = forwardRef<HTMLElement, PanelProps>(function Panel(
  {
    title,
    actions,
    footer,
    as: Tag = 'aside',
    variant = 'docked',
    className,
    bodyClassName,
    children,
    ...rest
  },
  ref,
) {
  const titleId = useId();
  return (
    <Tag
      ref={ref}
      aria-labelledby={titleId}
      className={cx(base, variantClass[variant], className)}
      {...rest}
    >
      <header className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-line px-4">
        <h2 id={titleId} className="min-w-0 truncate text-md font-semibold">
          {title}
        </h2>
        {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
      </header>
      <div className={cx('min-h-0 flex-1 overflow-y-auto p-4', bodyClassName)}>{children}</div>
      {footer ? <footer className="shrink-0 border-t border-line p-4">{footer}</footer> : null}
    </Tag>
  );
});
