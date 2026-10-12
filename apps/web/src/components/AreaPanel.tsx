import { COPY, LIMITS, type Area } from '@cgis/shared';
import { useState, type FormEvent } from 'react';
import { areaReadout } from '../lib/area-readout';
import {
  AreaConflictError,
  areaErrorMessage,
  formAreaName,
  useDeleteArea,
  useUpdateArea,
  type AreaEdit,
} from '../lib/areas-query';
import { Banner, Button, Field, IconClose, Input, Panel, Stat } from '../ui';

export type AreaPanelProps = {
  /** The selected area, as the viewport query has it now. */
  area: Area;
  onClose: () => void;
  /** A rename met a newer version (409): the parent asks the user (ConflictDialog). */
  onConflict: (edit: AreaEdit, current: Area) => void;
  onDeleted: () => void;
};

/**
 * Floating card for the selected area: its server-measured size, a rename form (`PUT` with the
 * version shown here) and delete. Key it by area id so the form starts over per area.
 */
export function AreaPanel({ area, onClose, onConflict, onDeleted }: AreaPanelProps) {
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
      className="absolute bottom-3 left-3 z-controls"
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
            <Input
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
      </div>
    </Panel>
  );
}
