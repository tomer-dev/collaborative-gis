import { cva, cx } from 'class-variance-authority';
import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { IconCheckCircle, IconError, IconInfo, IconWarning, type IconComponent } from './icons';

export type BannerTone = 'ok' | 'warn' | 'danger' | 'info';

export const bannerVariants = cva(
  'flex items-start gap-3 rounded-md border px-4 py-3 text-sm text-fg',
  {
    variants: {
      tone: {
        ok: 'border-ok bg-ok-bg',
        warn: 'border-warn bg-warn-bg',
        danger: 'border-danger bg-danger-bg',
        info: 'border-info bg-info-bg',
      },
    },
    defaultVariants: { tone: 'info' },
  },
);

const toneIcon: Record<BannerTone, { Icon: IconComponent; className: string }> = {
  ok: { Icon: IconCheckCircle, className: 'text-ok-strong' },
  warn: { Icon: IconWarning, className: 'text-warn-strong' },
  danger: { Icon: IconError, className: 'text-danger-strong' },
  info: { Icon: IconInfo, className: 'text-info-strong' },
};

export interface BannerProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  tone?: BannerTone;
  /** Short state label shown in bold next to the icon ("Offline", "Reconnecting"). */
  title: ReactNode;
  /** Optional detail sentence. */
  children?: ReactNode;
  /** Optional trailing control, e.g. a "Retry" button. */
  action?: ReactNode;
}

/**
 * Status banner (connection state and other page-level status). Tone is never colour alone: each
 * tone has its own icon and the title states it in words. `danger` is announced assertively
 * (role="alert"); the others politely (role="status").
 */
export const Banner = forwardRef<HTMLDivElement, BannerProps>(function Banner(
  { tone = 'info', title, children, action, className, ...rest },
  ref,
) {
  const { Icon, className: iconClass } = toneIcon[tone];
  return (
    <div
      ref={ref}
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cx(bannerVariants({ tone }), className)}
      {...rest}
    >
      <Icon className={cx('size-5', iconClass)} />
      <div className="flex min-w-0 flex-1 flex-wrap gap-x-2">
        <p className="font-semibold">{title}</p>
        {children ? <p>{children}</p> : null}
      </div>
      {action ? <div className="-my-1 shrink-0">{action}</div> : null}
    </div>
  );
});
