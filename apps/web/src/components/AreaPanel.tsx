import { COPY, LIMITS, type Area, type Bbox } from '@cgis/shared';
import { useRef, useState, type ComponentProps, type FormEvent, type RefObject } from 'react';
import { flushSync } from 'react-dom';
import { areaReadout } from '../lib/area-readout';
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
import { AreasInViewPanel, inView, PANEL_SIZE } from './AreasInViewPanel';

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
  /** The viewport query's state: loading and a failed load each say so, rather than "none". */
  list: ComponentProps<typeof AreasInViewPanel>['list'];
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
  list,
  bbox,
  pendingIds,
  selectedId,
  onSelect,
  onClose,
  ...selectedProps
}: AreaPanelProps) {
  const card = useRef<HTMLElement>(null);
  // Here, not in the list card: a pick unmounts that card, and Close must bring it back as it was
  // (on a phone, a refolded list would hide the row that Close puts focus on).
  const [unfolded, setUnfolded] = useState(false);
  const saved = areas.filter((area) => !pendingIds.has(area.id));
  const selected = saved.find((area) => area.id === selectedId);
  // A pick or a Close swaps the card under the button that had focus: the other card renders now
  // and focus goes to its control for the same area (the picked area's Close, the closed row).
  const swapTo = (change: () => void, id: string) => {
    flushSync(change);
    const target = card.current?.querySelector(`[data-area-id="${id}"]`);
    if (target instanceof HTMLElement) target.focus();
  };

  if (selected) {
    return (
      <SelectedAreaPanel
        key={selected.id}
        cardRef={card}
        area={selected}
        onClose={() => swapTo(onClose, selected.id)}
        {...selectedProps}
      />
    );
  }
  return (
    <AreasInViewPanel
      cardRef={card}
      areas={inView(saved, bbox)}
      list={list}
      unfolded={unfolded}
      onToggleFold={() => setUnfolded(!unfolded)}
      onSelect={(area) => swapTo(() => onSelect(area), area.id)}
    />
  );
}

type SelectedAreaPanelProps = SelectedAreaProps & {
  /** The card's section, for AreaPanel's focus moves. */
  cardRef: RefObject<HTMLElement | null>;
  /** The selected area, as the viewport query has it now. */
  area: Area;
};

/**
 * The selected area: its server-measured size, a rename form (`PUT` with the version shown here),
 * delete, and its history with revert. Keyed by area id so the form starts over per area.
 */
function SelectedAreaPanel({
  cardRef,
  area,
  onClose,
  onConflict,
  onDeleted,
}: SelectedAreaPanelProps) {
  const update = useUpdateArea();
  const remove = useDeleteArea();
  const [nameError, setNameError] = useState<string | null>(null);
  // A conflict is the parent's to show; any other failure is shown here.
  const renameFailed = update.isError && !(update.error instanceof AreaConflictError);

  function handleRename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = formAreaName(new FormData(event.currentTarget));
    setNameError(name === null ? COPY.AREAS.NAME_REQUIRED : null);
    // The same name saves nothing: no request, no new version in the history.
    if (name === null || name === area.name) return;
    const edit = { id: area.id, body: { name, geometry: area.geometry, version: area.version } };
    update.mutate(edit, {
      onError: (error) => {
        if (error instanceof AreaConflictError) onConflict(edit, error.current);
      },
    });
  }

  return (
    <Panel
      ref={cardRef}
      as="section"
      variant="floating"
      title={area.name}
      className={PANEL_SIZE}
      actions={
        <Button
          variant="ghost"
          size="sm"
          icon={IconClose}
          aria-label={COPY.AREAS.CLOSE}
          data-area-id={area.id}
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
            <DeleteButton
              pending={remove.isPending}
              onDelete={() => remove.mutate(area.id, { onSuccess: () => onDeleted() })}
            />
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

type DeleteButtonProps = { pending: boolean; onDelete: () => void };

/** Delete in two clicks, no dialog: Delete, then Yes in the inline "Delete?" (No goes back). */
function DeleteButton({ pending, onDelete }: DeleteButtonProps) {
  const [confirming, setConfirming] = useState(false);
  const deleteButton = useRef<HTMLButtonElement>(null);
  // No unmounts the button that had focus: render Delete now and put focus back on it.
  const back = () => {
    flushSync(() => setConfirming(false));
    deleteButton.current?.focus();
  };

  if (confirming) {
    return (
      <div
        role="group"
        aria-label={COPY.AREAS.DELETE_CONFIRM}
        className="mr-auto flex items-center gap-2"
      >
        <span className="text-sm font-medium">{COPY.AREAS.DELETE_CONFIRM}</span>
        <Button
          variant="danger"
          size="sm"
          onClick={() => {
            setConfirming(false);
            onDelete();
          }}
        >
          {COPY.AREAS.DELETE_YES}
        </Button>
        <Button variant="secondary" size="sm" autoFocus onClick={back}>
          {COPY.AREAS.DELETE_NO}
        </Button>
      </div>
    );
  }
  return (
    <Button
      ref={deleteButton}
      variant="danger"
      size="sm"
      className="mr-auto"
      disabled={pending}
      onClick={() => setConfirming(true)}
    >
      {pending ? COPY.AREAS.DELETE_PENDING : COPY.AREAS.DELETE}
    </Button>
  );
}
