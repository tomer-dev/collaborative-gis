import { type Bbox, COPY, LIMITS, type Area } from '@cgis/shared';
import { useEffect, useEffectEvent, useState, type FormEvent } from 'react';
import { areaDiffers, areaReadout, formatArea } from '../lib/area-readout';
import { areaErrorMessage, formAreaName, useCreateArea } from '../lib/areas-query';
import { ringAreaKm2, type LngLat } from '../lib/geo/geodesic';
import { Banner, Button, Dialog, Field, Input, Stat } from '../ui';

export type SaveDialogProps = {
  /** The finished sketch from `draw:done`: a closed GeoJSON ring. */
  ring: LngLat[];
  /** The viewport the new area joins at once (optimistic create). */
  bbox: Bbox | null;
  /** The dialog has closed (Cancel, Escape, or Done after the save); the parent unmounts it. */
  onClose: () => void;
};

/**
 * Names and saves a finished sketch. Before the save it shows the client's area estimate; after
 * it, the server's area (PostGIS on the spheroid) in its place, plus one line with both values
 * when they differ by more than `MAP.AREA_DIFF_WARN_RATIO`.
 */
export function SaveDialog({ ring, bbox, onClose }: SaveDialogProps) {
  const create = useCreateArea(bbox);
  const estimate = ringAreaKm2(ring);
  // Closing is two steps: the dialog closes itself (focus back to its opener), then the parent unmounts it.
  const [open, setOpen] = useState(true);
  const closed = useEffectEvent(onClose);
  useEffect(() => {
    if (!open) closed();
  }, [open]);
  const close = () => setOpen(false);
  const saved = create.data;

  return (
    <Dialog
      open={open}
      onClose={close}
      title={saved ? COPY.AREAS.SAVED_TITLE : COPY.AREAS.SAVE_TITLE}
      description={saved?.name}
    >
      {saved ? (
        <SavedArea area={saved} estimate={estimate} onDone={close} />
      ) : (
        <SaveForm
          estimate={estimate}
          pending={create.isPending}
          error={create.isError ? areaErrorMessage(create.error) : null}
          onSubmit={(name) =>
            create.mutate({ name, geometry: { type: 'Polygon', coordinates: [ring] } })
          }
          onCancel={close}
        />
      )}
    </Dialog>
  );
}

type SaveFormProps = {
  estimate: number;
  pending: boolean;
  /** The failed save's message (PostGIS's reason on a 422), or null. */
  error: string | null;
  onSubmit: (name: string) => void;
  onCancel: () => void;
};

function SaveForm({ estimate, pending, error, onSubmit, onCancel }: SaveFormProps) {
  const [nameError, setNameError] = useState<string | null>(null);

  // Uncontrolled input: the browser enforces required and maxLength before this runs.
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = formAreaName(new FormData(event.currentTarget));
    setNameError(name === null ? COPY.AREAS.NAME_REQUIRED : null);
    if (name !== null) onSubmit(name);
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
      {error === null ? null : (
        <Banner tone="danger" title={COPY.AREAS.SAVE_ERROR_TITLE}>
          {error}
        </Banner>
      )}
      <Field label={COPY.AREAS.NAME_LABEL} hint={COPY.AREAS.NAME_HINT} error={nameError} required>
        <Input name="name" maxLength={LIMITS.AREA_NAME_MAX} autoComplete="off" autoFocus />
      </Field>
      <Stat label={COPY.AREAS.ESTIMATE_LABEL} size="md" {...areaReadout(estimate)} />
      <div className="flex flex-wrap justify-end gap-2 pt-2">
        <Button variant="secondary" onClick={onCancel}>
          {COPY.AREAS.CANCEL}
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? COPY.AREAS.SAVE_PENDING : COPY.AREAS.SAVE_SUBMIT}
        </Button>
      </div>
    </form>
  );
}

function SavedArea({
  area,
  estimate,
  onDone,
}: {
  area: Area;
  estimate: number;
  onDone: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <Stat label={COPY.AREAS.AREA_LABEL} size="md" live {...areaReadout(area.areaKm2)} />
      {areaDiffers(area.areaKm2, estimate) ? (
        <p className="text-sm text-fg-muted">
          {COPY.AREAS.AREA_DIFF_NOTE(formatArea(area.areaKm2), formatArea(estimate))}
        </p>
      ) : null}
      <div className="flex justify-end pt-2">
        <Button onClick={onDone} autoFocus>
          {COPY.AREAS.DONE}
        </Button>
      </div>
    </div>
  );
}
