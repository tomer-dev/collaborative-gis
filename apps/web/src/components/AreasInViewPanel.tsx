import { COPY, type Area, type Bbox } from '@cgis/shared';
import * as L from 'leaflet';
import type { RefObject } from 'react';
import { formatArea } from '../lib/area-readout';
import { areaBounds } from '../lib/map';
import { Banner, Button, IconChevronDown, IconChevronUp, Panel } from '../ui';

/**
 * Both area cards (this one and AreaPanel's selected area) stop at `max-h-panel` and scroll their
 * body. In the map's corner column, when the column runs out of height, they give up height four
 * times as readily as the presence list below, so its short list of people stays readable.
 */
export const PANEL_SIZE = 'max-h-panel shrink-4';

/** The areas whose bounds meet `bbox`, the same test as the server's `&&` on the bounds query. */
export function inView(areas: readonly Area[], bbox: Bbox | null): Area[] {
  if (bbox === null) return [];
  const [west, south, east, north] = bbox;
  const view = L.latLngBounds([south, west], [north, east]);
  return areas.filter((area) => areaBounds(area).intersects(view));
}

type AreasInViewPanelProps = {
  /** The card's section, for AreaPanel's focus moves. */
  cardRef: RefObject<HTMLElement | null>;
  areas: readonly Area[];
  /** What the list needs from the viewport query (`useAreasInBounds`) besides its areas. */
  list: {
    /** No answer yet for this viewport (and no last one to show meanwhile). */
    isPending: boolean;
    /** The first load failed (no areas to show); a failed refetch keeps the areas it has. */
    isLoadingError: boolean;
    /** The error's Retry. */
    refetch: () => unknown;
  };
  /** Below `sm`: the list is shown (AreaPanel keeps it, so a pick and a Close do not refold it). */
  unfolded: boolean;
  onToggleFold: () => void;
  onSelect: (area: Area) => void;
};

/**
 * The areas in view with their size; the panel body scrolls (the server caps a viewport's areas).
 * On a phone (below `sm`) the list starts folded behind a header button, so the map stays free.
 * Each row carries `data-area-id`, where AreaPanel puts focus back after a Close.
 */
export function AreasInViewPanel({
  cardRef,
  areas,
  list,
  unfolded,
  onToggleFold,
  onSelect,
}: AreasInViewPanelProps) {
  // Retry's banner gives way to "Loading…": focus waits on the card (not a tab stop) meanwhile.
  const retry = () => {
    cardRef.current?.focus();
    list.refetch();
  };
  return (
    <Panel
      ref={cardRef}
      tabIndex={-1}
      as="section"
      variant="floating"
      title={COPY.AREAS.LIST_TITLE}
      className={PANEL_SIZE}
      bodyClassName={unfolded ? undefined : 'max-sm:hidden'}
      actions={
        <Button
          variant="ghost"
          size="sm"
          className="sm:hidden"
          icon={unfolded ? IconChevronDown : IconChevronUp}
          aria-label={unfolded ? COPY.AREAS.LIST_HIDE : COPY.AREAS.LIST_SHOW}
          onClick={onToggleFold}
        />
      }
    >
      <AreaList areas={areas} list={list} onSelect={onSelect} onRetry={retry} />
    </Panel>
  );
}

type AreaListProps = Pick<AreasInViewPanelProps, 'areas' | 'list' | 'onSelect'> & {
  onRetry: () => void;
};

/** Loading, a failed first load (with Retry), no areas in view, or the areas. */
function AreaList({ areas, list, onSelect, onRetry }: AreaListProps) {
  if (list.isPending) return <p className="text-sm text-fg-muted">{COPY.AREAS.LIST_LOADING}</p>;
  if (list.isLoadingError) {
    const retry = (
      <Button variant="secondary" size="sm" onClick={onRetry}>
        {COPY.AREAS.LIST_RETRY}
      </Button>
    );
    return (
      <Banner tone="danger" title={COPY.AREAS.LIST_ERROR_TITLE} action={retry}>
        {COPY.AREAS.ERROR_GENERIC}
      </Banner>
    );
  }
  if (areas.length === 0) return <p className="text-sm text-fg-muted">{COPY.AREAS.LIST_EMPTY}</p>;
  return (
    <ul className="-mx-2 flex flex-col">
      {areas.map((area) => (
        <li key={area.id}>
          <Button
            variant="ghost"
            size="sm"
            className="w-full"
            data-area-id={area.id}
            onClick={() => onSelect(area)}
          >
            <span className="min-w-0 flex-1 truncate text-left">{area.name}</span>
            <span className="font-normal text-fg-muted tabular-nums">
              {formatArea(area.areaKm2)}
            </span>
          </Button>
        </li>
      ))}
    </ul>
  );
}
