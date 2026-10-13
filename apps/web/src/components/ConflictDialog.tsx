import { COPY, type Area } from '@cgis/shared';
import { useQueryClient } from '@tanstack/react-query';
import {
  AreaConflictError,
  areaErrorMessage,
  useUpdateArea,
  type AreaEdit,
} from '../lib/areas-mutations';
import { replaceArea } from '../lib/areas-query';
import { Banner, Button, Dialog } from '../ui';

export type ConflictDialogProps = {
  /** The edit the server refused with 409. */
  edit: AreaEdit;
  /** The stored area the 409 carried (`details.current`). */
  current: Area;
  /** The conflict is settled; `area` is what the map now shows (the overwrite's result, or theirs). */
  onResolved: (area: Area) => void;
  /** The overwrite met yet another version: ask again with that one. */
  onConflict: (edit: AreaEdit, current: Area) => void;
  /** Escape: leave things as they are. */
  onClose: () => void;
};

/**
 * Spec D4's two-button prompt after a 409. "Overwrite with mine" resends the edit on top of
 * `current.version`; "Load theirs" puts `current` into every cached viewport. "Load theirs" comes
 * first and takes the initial focus: it is the one that cannot lose anyone's work.
 */
export function ConflictDialog({
  edit,
  current,
  onResolved,
  onConflict,
  onClose,
}: ConflictDialogProps) {
  const queryClient = useQueryClient();
  const overwrite = useUpdateArea();
  const failed = overwrite.isError && !(overwrite.error instanceof AreaConflictError);

  function overwriteWithMine() {
    overwrite.mutate(
      { id: edit.id, body: { ...edit.body, version: current.version } },
      {
        onSuccess: (area) => onResolved(area),
        onError: (error) => {
          if (error instanceof AreaConflictError) onConflict(edit, error.current);
        },
      },
    );
  }

  function loadTheirs() {
    replaceArea(queryClient, current);
    onResolved(current);
  }

  return (
    <Dialog
      open
      role="alertdialog"
      onClose={onClose}
      title={COPY.AREAS.CONFLICT_TITLE}
      description={COPY.AREAS.CONFLICT_DESCRIPTION}
      footer={
        <>
          <Button variant="secondary" disabled={overwrite.isPending} onClick={loadTheirs}>
            {COPY.AREAS.LOAD_THEIRS}
          </Button>
          <Button disabled={overwrite.isPending} onClick={overwriteWithMine}>
            {COPY.AREAS.OVERWRITE}
          </Button>
        </>
      }
    >
      {failed ? (
        <Banner tone="danger" title={COPY.AREAS.OVERWRITE_ERROR_TITLE}>
          {areaErrorMessage(overwrite.error)}
        </Banner>
      ) : null}
      <dl className="flex flex-col gap-2 text-sm">
        <div className="flex gap-2">
          <dt className="font-medium">{COPY.AREAS.CONFLICT_MINE_LABEL}</dt>
          <dd className="min-w-0 truncate text-fg-muted">{edit.body.name}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="font-medium">{COPY.AREAS.CONFLICT_THEIRS_LABEL}</dt>
          <dd className="min-w-0 truncate text-fg-muted">{current.name}</dd>
        </div>
      </dl>
    </Dialog>
  );
}
