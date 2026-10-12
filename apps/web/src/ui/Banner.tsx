import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { cx } from './cx';
import { IconCheckCircle, IconError, IconInfo, IconWarning, type IconComponent } from './icons';

export type BannerTone = 'ok' | 'warn' | 'danger' | 'info';

const base = 'flex items-start gap-3 rounded-md border px-4 py-3 text-sm text-fg';

const tones: Record<BannerTone, { box: string; Icon: IconComponent; icon: string }> = {
  ok: { box: 'border-ok bg-ok-bg', Icon: IconCheckCircle, icon: 'text-ok-strong' },
  warn: { box: 'border-warn bg-warn-bg', Icon: IconWarning, icon: 'text-warn-strong' },
  danger: { box: 'border-danger bg-danger-bg', Icon: IconError, icon: 'text-danger-strong' },
  info: { box: 'border-info bg-info-bg', Icon: IconInfo, icon: 'text-info-strong' },
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
  const { box, Icon, icon } = tones[tone];
  return (
    <div
      ref={ref}
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cx(base, box, className)}
      {...rest}
    >
      <Icon className={cx('size-5 shrink-0', icon)} />
      <div className="flex min-w-0 flex-1 flex-wrap gap-x-2">
        <p className="font-semibold">{title}</p>
        {children ? <p>{children}</p> : null}
      </div>
      {action ? <div className="-my-1 shrink-0">{action}</div> : null}
    </div>
  );
});
