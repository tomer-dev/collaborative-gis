import { COPY } from '@cgis/shared';
import type { RoomState } from '../lib/use-room';
import { Banner, Button, type BannerTone } from '../ui';

type BannerCopy = { tone: BannerTone; title: string; detail: string; retry: boolean };

/** What each room state shows; connecting (start-up, one quick retry) and open show nothing. */
const banners: Record<RoomState, BannerCopy | null> = {
  connecting: null,
  open: null,
  resyncing: {
    tone: 'info',
    title: COPY.CONNECTION.RESYNC_TITLE,
    detail: COPY.CONNECTION.RESYNC_DETAIL,
    retry: false,
  },
  degraded: {
    tone: 'warn',
    title: COPY.CONNECTION.DEGRADED_TITLE,
    detail: COPY.CONNECTION.DEGRADED_DETAIL,
    retry: false,
  },
  offline: {
    tone: 'danger',
    title: COPY.CONNECTION.OFFLINE_TITLE,
    detail: COPY.CONNECTION.OFFLINE_DETAIL,
    retry: true,
  },
};

export type ConnectionBannerProps = {
  /** `useRoom().state`. */
  state: RoomState;
  /** The offline banner's Retry: connect now (`useRoom().reconnect`). */
  onRetry: () => void;
};

/** Resyncing / degraded / offline notice floating at the top centre of the map. */
export function ConnectionBanner({ state, onRetry }: ConnectionBannerProps) {
  const banner = banners[state];
  if (!banner) return null;
  const retry = banner.retry ? (
    <Button variant="secondary" size="sm" onClick={onRetry}>
      {COPY.CONNECTION.RETRY}
    </Button>
  ) : null;
  return (
    <div className="absolute inset-x-16 top-3 z-controls mx-auto max-w-md">
      <Banner tone={banner.tone} title={banner.title} action={retry} className="shadow-raised">
        {banner.detail}
      </Banner>
    </div>
  );
}
