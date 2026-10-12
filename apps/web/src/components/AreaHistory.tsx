import {
  COPY,
  ERROR_CODES,
  LIMITS,
  type Area,
  type AreaVersion,
  type VersionsResponse,
} from '@cgis/shared';
import type { UseQueryResult } from '@tanstack/react-query';
import { useId } from 'react';
import { ApiRequestError } from '../lib/api-client';
import { formatArea } from '../lib/area-readout';
import {
  AreaConflictError,
  areaErrorMessage,
  useAreaVersions,
  useRevertArea,
  type AreaEdit,
} from '../lib/areas-query';
import { Banner, Button } from '../ui';

const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 60 * SECONDS_PER_MINUTE;
const SECONDS_PER_DAY = 24 * SECONDS_PER_HOUR;

/** `Intl.RelativeTimeFormat` units, largest first, with their length in seconds (calendar-free). */
const RELATIVE_UNITS = [
  ['year', 365 * SECONDS_PER_DAY],
  ['month', 30 * SECONDS_PER_DAY],
  ['week', 7 * SECONDS_PER_DAY],
  ['day', SECONDS_PER_DAY],
  ['hour', SECONDS_PER_HOUR],
  ['minute', SECONDS_PER_MINUTE],
] as const satisfies readonly (readonly [Intl.RelativeTimeFormatUnit, number])[];

const relativeFormat = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** `iso` from now in the user's locale, in the largest unit it spans ("5 minutes ago", "yesterday"). */
function timeAgo(iso: string): string {
  const seconds = (Date.parse(iso) - Date.now()) / MS_PER_SECOND;
  const [unit, size] = RELATIVE_UNITS.find(([, length]) => Math.abs(seconds) >= length) ?? [
    'second',
    1,
  ];
  return relativeFormat.format(Math.round(seconds / size), unit);
}

/** A failed revert's own copy by API code: 409 = the area is deleted, 404 = it or the version is gone. */
const REVERT_MESSAGES: Partial<Record<string, string>> = {
  [ERROR_CODES.CONFLICT]: COPY.AREAS.REVERT_DELETED,
  [ERROR_CODES.NOT_FOUND]: COPY.AREAS.REVERT_MISSING,
};

function revertErrorMessage(error: Error): string {
  return (
    (error instanceof ApiRequestError && REVERT_MESSAGES[error.code]) || areaErrorMessage(error)
  );
}

export type AreaHistoryProps = {
  /** The selected area as the areas cache has it now; its version keys the history. */
  area: Area;
  /**
   * A revert met a newer version (409, D4): the parent asks the user (ConflictDialog). The edit is
   * the reverted version's name and geometry on top of the version this panel showed, so
   * "Overwrite with mine" saves the revert's result over theirs.
   */
  onConflict: (edit: AreaEdit, current: Area) => void;
};

/**
 * The selected area's saved versions, newest first: number, name, area, who saved it and when.
 * Any version but the area's own can be brought back, one revert at a time; the reverted area
 * lands in the areas cache, and its new version refetches this history. A revert names the
 * version shown here, so another user's newer edit is a conflict, not silently undone.
 */
export function AreaHistory({ area, onConflict }: AreaHistoryProps) {
  const titleId = useId();
  const history = useAreaVersions(area.id, area.version);
  const revert = useRevertArea();
  // A conflict is the parent's to show; any other failure is shown here.
  const failed = revert.isError && !(revert.error instanceof AreaConflictError);

  function revertTo({ version, name, geometry }: AreaVersion) {
    const expected = area.version;
    revert.mutate(
      { id: area.id, version, expected },
      {
        onError: (error) => {
          if (!(error instanceof AreaConflictError)) return;
          onConflict({ id: area.id, body: { name, geometry, version: expected } }, error.current);
        },
      },
    );
  }

  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-2 border-t border-line pt-4">
      <h3 id={titleId} className="text-sm font-semibold">
        {COPY.AREAS.HISTORY_TITLE}
      </h3>
      {failed ? (
        <Banner tone="danger" title={COPY.AREAS.REVERT_ERROR_TITLE}>
          {revertErrorMessage(revert.error)}
        </Banner>
      ) : null}
      <VersionList
        history={history}
        current={area.version}
        reverting={revert.isPending ? revert.variables.version : null}
        onRevert={revertTo}
      />
    </section>
  );
}

type VersionListProps = {
  history: UseQueryResult<VersionsResponse>;
  /** The area's version now: that row is marked current instead of offering a revert. */
  current: number;
  /** The version a revert is in flight for, or null. */
  reverting: number | null;
  onRevert: (version: AreaVersion) => void;
};

function VersionList({ history, current, reverting, onRevert }: VersionListProps) {
  if (history.isPending) {
    return <p className="text-sm text-fg-muted">{COPY.AREAS.HISTORY_LOADING}</p>;
  }
  if (history.isError) {
    return (
      <Banner tone="danger" title={COPY.AREAS.HISTORY_ERROR_TITLE}>
        {areaErrorMessage(history.error)}
      </Banner>
    );
  }
  return (
    <ol className="flex flex-col divide-y divide-line">
      {history.data.versions.map((version) => (
        <VersionRow
          key={version.version}
          version={version}
          isCurrent={version.version === current}
          reverting={reverting}
          onRevert={onRevert}
        />
      ))}
    </ol>
  );
}

type VersionRowProps = {
  version: AreaVersion;
  isCurrent: boolean;
  reverting: number | null;
  onRevert: (version: AreaVersion) => void;
};

function VersionRow({ version, isCurrent, reverting, onRevert }: VersionRowProps) {
  const labelId = useId();
  return (
    <li className="flex flex-col gap-1 py-2">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span id={labelId} className="font-medium">
          {COPY.AREAS.VERSION_LABEL(version.version)}
        </span>
        <span className="text-fg-muted tabular-nums">{formatArea(version.areaKm2)}</span>
      </div>
      <p className="truncate text-sm">{version.name}</p>
      <p className="flex flex-wrap gap-x-2 text-xs text-fg-muted">
        <span>{COPY.AREAS.VERSION_BY(version.changedBy.slice(0, LIMITS.USER_ID_PREFIX))}</span>
        <time dateTime={version.changedAt} title={dateFormat.format(Date.parse(version.changedAt))}>
          {timeAgo(version.changedAt)}
        </time>
      </p>
      {isCurrent ? (
        <p className="text-xs font-medium text-fg-muted">{COPY.AREAS.VERSION_CURRENT}</p>
      ) : (
        <Button
          variant="secondary"
          size="sm"
          className="self-start"
          aria-describedby={labelId}
          disabled={reverting !== null}
          onClick={() => onRevert(version)}
        >
          {reverting === version.version ? COPY.AREAS.REVERT_PENDING : COPY.AREAS.REVERT}
        </Button>
      )}
    </li>
  );
}
