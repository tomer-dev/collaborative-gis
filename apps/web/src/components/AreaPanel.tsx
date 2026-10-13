import { COPY, LIMITS, type Area, type Bbox } from '@cgis/shared';
import * as L from 'leaflet';
import { useState, type FormEvent } from 'react';
import { areaReadout, formatArea } from '../lib/area-readout';
import {
  AreaConflictError,
  areaErrorMessage,
  formAreaName,
  useDeleteArea,
  useUpdateArea,
  type AreaEdit,
} from '../lib/areas-mutations';
import { Banner, Button, Field, IconClose, Input, Panel, Stat } from '../ui';
import { AreaHistory } from './AreaHistory';

type SelectedAreaProps = {
  onClose: () => void;
  /** A rename or a revert met a newer version (409): the parent asks the user (ConflictDialog). */
  onConflict: (edit: AreaEdit, current: Area) => void;
  onDeleted: () => void;
};

export type AreaPanelProps = SelectedAreaProps & {
  /**
   * The viewport query's areas. They can reach past `bbox`: the WebSocket adds an area to every
   * cached list, and the last viewport's list stays while the next one loads.
   */
  areas: readonly Area[];
  /** The current viewport; the list shows the areas whose bounds meet it. */
  bbox: Bbox | null;
  /** Optimistic areas whose create is in flight (`usePendingAreaIds`): never listed or opened. */
  pendingIds: ReadonlySet<string>;
  /** The selected area's id, or null. */
  selectedId: string | null;
  /** A listed area was picked: the parent selects it, as a click on its polygon does. */
  onSelect: (area: Area) => void;
};

/**
 * The map's area card. With an area selected it shows that area (rename, delete, history);
 * otherwise the areas in view, each one selectable. An area being created is in neither: its
 * temporary id would 404.
 */
export function AreaPanel({
  areas,
  bbox,
  pendingIds,
  selectedId,
  onSelect,
  ...selectedProps
}: AreaPanelProps) {
  const saved = areas.filter((area) => !pendingIds.has(area.id));
  const selected = saved.find((area) => area.id === selectedId);
  if (selected) return <SelectedAreaPanel key={selected.id} area={selected} {...selectedProps} />;
  return <AreasInViewPanel areas={inView(saved, bbox)} onSelect={onSelect} />;
}

/** The areas whose bounds meet `bbox`, the same test as the server's `&&` on the bounds query. */
function inView(areas: readonly Area[], bbox: Bbox | null): Area[] {
  if (bbox === null) return [];
  const [west, south, east, north] = bbox;
  const view = L.latLngBounds([south, west], [north, east]);
  return areas.filter((area) =>
    L.latLngBounds(area.geometry.coordinates[0].map(([lng, lat]) => L.latLng(lat, lng))).intersects(
      view,
    ),
  );
}

type AreasInViewPanelProps = { areas: readonly Area[]; onSelect: (area: Area) => void };

/** The areas in view with their size; the panel body scrolls (the server caps a viewport's areas). */
function AreasInViewPanel({ areas, onSelect }: AreasInViewPanelProps) {
  return (
    <Panel as="section" variant="floating" title={COPY.AREAS.LIST_TITLE} className="max-h-panel">
      <AreaList areas={areas} onSelect={onSelect} />
    </Panel>
  );
}

function AreaList({ areas, onSelect }: AreasInViewPanelProps) {
  if (areas.length === 0) return <p className="text-sm text-fg-muted">{COPY.AREAS.LIST_EMPTY}</p>;
  return (
    <ul className="-mx-2 flex flex-col">
      {areas.map((area) => (
        <li key={area.id}>
          <Button variant="ghost" size="sm" className="w-full" onClick={() => onSelect(area)}>
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

type SelectedAreaPanelProps = SelectedAreaProps & {
  /** The selected area, as the viewport query has it now. */
  area: Area;
};

/**
 * The selected area: its server-measured size, a rename form (`PUT` with the version shown here),
 * delete, and its history with revert. Keyed by area id so the form starts over per area.
 */
function SelectedAreaPanel({ area, onClose, onConflict, onDeleted }: SelectedAreaPanelProps) {
  const update = useUpdateArea();
  const remove = useDeleteArea();
  const [nameError, setNameError] = useState<string | null>(null);
  // A conflict is the parent's to show; any other failure is shown here.
  const renameFailed = update.isError && !(update.error instanceof AreaConflictError);

  function handleRename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = formAreaName(new FormData(event.currentTarget));
    setNameError(name === null ? COPY.AREAS.NAME_REQUIRED : null);
    if (name === null) return;
    const edit = { id: area.id, body: { name, geometry: area.geometry, version: area.version } };
    update.mutate(edit, {
      onError: (error) => {
        if (error instanceof AreaConflictError) onConflict(edit, error.current);
      },
    });
  }

  return (
    <Panel
      as="section"
      variant="floating"
      title={area.name}
      className="max-h-panel"
      actions={
        <Button
          variant="ghost"
          size="sm"
          icon={IconClose}
          aria-label={COPY.AREAS.CLOSE}
          onClick={onClose}
        />
      }
    >
      <div className="flex flex-col gap-4">
        <Stat label={COPY.AREAS.AREA_LABEL} size="md" {...areaReadout(area.areaKm2)} />
        {renameFailed ? (
          <Banner tone="danger" title={COPY.AREAS.RENAME_ERROR_TITLE}>
            {areaErrorMessage(update.error)}
          </Banner>
        ) : null}
        {remove.isError ? (
          <Banner tone="danger" title={COPY.AREAS.DELETE_ERROR_TITLE}>
            {areaErrorMessage(remove.error)}
          </Banner>
        ) : null}
        <form className="flex flex-col gap-2" onSubmit={handleRename}>
          <Field
            label={COPY.AREAS.NAME_LABEL}
            hint={COPY.AREAS.NAME_HINT}
            error={nameError}
            required
          >
            {/* Keyed by the name: a revert or another user's rename refills the field. */}
            <Input
              key={area.name}
              name="name"
              size="sm"
              defaultValue={area.name}
              maxLength={LIMITS.AREA_NAME_MAX}
              autoComplete="off"
            />
          </Field>
          <div className="flex gap-2">
            <Button
              variant="danger"
              size="sm"
              className="mr-auto"
              disabled={remove.isPending}
              onClick={() => remove.mutate(area.id, { onSuccess: () => onDeleted() })}
            >
              {remove.isPending ? COPY.AREAS.DELETE_PENDING : COPY.AREAS.DELETE}
            </Button>
            <Button type="submit" size="sm" disabled={update.isPending}>
              {update.isPending ? COPY.AREAS.RENAME_PENDING : COPY.AREAS.RENAME_SUBMIT}
            </Button>
          </div>
        </form>
        <AreaHistory area={area} onConflict={onConflict} />
      </div>
    </Panel>
  );
}
