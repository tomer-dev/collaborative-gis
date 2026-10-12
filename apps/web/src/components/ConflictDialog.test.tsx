import { COPY, ERROR_CODES, ERROR_REASONS, type AreaList } from '@cgis/shared';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { areasKey, type AreaEdit } from '../lib/areas-query';
import type { Bbox } from '@cgis/shared';
import {
  AREA_ID,
  jsonResponse,
  makeArea,
  OTHER_ID,
  queryWrapper,
  stubApi,
  stubDialogModal,
  type StubHandler,
} from '../test/api-stub';
import { ConflictDialog } from './ConflictDialog';

beforeAll(stubDialogModal);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ISRAEL: Bbox = [34.2, 29.5, 35.9, 33.3];
const stale = makeArea(AREA_ID, { name: 'Orchard', version: 1 });
const theirs = makeArea(AREA_ID, { name: 'Their orchard', version: 2 });
const vineyard = makeArea(OTHER_ID, { name: 'Vineyard' });
const edit: AreaEdit = {
  id: AREA_ID,
  body: { name: 'My orchard', geometry: stale.geometry, version: 1 },
};

function renderDialog(handler: StubHandler) {
  const requests = stubApi(handler);
  const { queryClient, wrapper: Wrapper } = queryWrapper();
  queryClient.setQueryData<AreaList>(areasKey(ISRAEL), { areas: [stale, vineyard] });
  const props = { onResolved: vi.fn(), onConflict: vi.fn(), onClose: vi.fn() };
  render(<ConflictDialog edit={edit} current={theirs} {...props} />, { wrapper: Wrapper });
  return { requests, queryClient, ...props };
}

const button = (name: string) => screen.getByRole('button', { name });

it('shows both names and the two D4 actions, "Load theirs" first', () => {
  renderDialog(() => jsonResponse(500, {}));

  const dialog = screen.getByRole('alertdialog', { name: COPY.AREAS.CONFLICT_TITLE });
  expect(dialog.textContent).toContain('My orchard');
  expect(dialog.textContent).toContain('Their orchard');
  const actions = screen.getAllByRole('button').map((element) => element.textContent);
  expect(actions).toEqual([COPY.AREAS.LOAD_THEIRS, COPY.AREAS.OVERWRITE]);
});

it('"Load theirs" puts the server copy in the cache, sends nothing, and resolves with it', () => {
  const { queryClient, requests, onResolved } = renderDialog(() => jsonResponse(500, {}));

  fireEvent.click(button(COPY.AREAS.LOAD_THEIRS));

  expect(queryClient.getQueryData(areasKey(ISRAEL))).toEqual({ areas: [theirs, vineyard] });
  expect(requests).toEqual([]);
  expect(onResolved).toHaveBeenCalledWith(theirs);
});

it('"Overwrite with mine" resends the edit on top of current.version', async () => {
  const overwritten = makeArea(AREA_ID, { name: 'My orchard', version: 3 });
  const { queryClient, requests, onResolved } = renderDialog(() => jsonResponse(200, overwritten));

  fireEvent.click(button(COPY.AREAS.OVERWRITE));

  await waitFor(() => expect(onResolved).toHaveBeenCalledWith(overwritten));
  expect(requests).toEqual([
    expect.objectContaining({
      method: 'PUT',
      path: `/api/areas/${AREA_ID}`,
      body: { ...edit.body, version: theirs.version },
    }),
  ]);
  expect(queryClient.getQueryData(areasKey(ISRAEL))).toEqual({ areas: [overwritten, vineyard] });
});

it('asks again with the newer copy when the overwrite meets another version', async () => {
  const newest = makeArea(AREA_ID, { name: 'Newest', version: 4 });
  const { onConflict, onResolved } = renderDialog(() =>
    jsonResponse(409, {
      code: ERROR_CODES.CONFLICT,
      message: ERROR_REASONS.VERSION_CONFLICT,
      details: { current: newest },
    }),
  );

  fireEvent.click(button(COPY.AREAS.OVERWRITE));

  await waitFor(() => expect(onConflict).toHaveBeenCalledWith(edit, newest));
  expect(onResolved).not.toHaveBeenCalled();
  expect(screen.queryByRole('alert')).toBeNull();
});
