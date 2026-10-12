import { COPY, ERROR_CODES, ERROR_REASONS, MAP, type AreaList } from '@cgis/shared';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { formatArea } from '../lib/area-readout';
import { areasKey } from '../lib/areas-query';
import { ringAreaKm2 } from '../lib/geo/geodesic';
import type { Bbox } from '../lib/map';
import {
  AREA_ID,
  jsonResponse,
  makeArea,
  queryWrapper,
  SQUARE,
  stubApi,
  stubDialogModal,
} from '../test/api-stub';
import { SaveDialog } from './SaveDialog';

vi.mock('../lib/auth-client', () => ({
  authClient: {
    useSession: () => ({ data: { user: { id: 'user_1', name: 'Ada' } }, isPending: false }),
  },
}));

beforeAll(stubDialogModal);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ISRAEL: Bbox = [34.2, 29.5, 35.9, 33.3];
const estimate = ringAreaKm2(SQUARE);

/** Renders the dialog for SQUARE; POST /api/areas answers with `post`, the list with []. */
function renderDialog(post: () => Response) {
  const requests = stubApi(({ method }) =>
    method === 'POST' ? post() : jsonResponse(200, { areas: [] }),
  );
  const { queryClient, wrapper: Wrapper } = queryWrapper();
  queryClient.setQueryData<AreaList>(areasKey(ISRAEL), { areas: [] });
  const onClose = vi.fn();
  render(<SaveDialog ring={SQUARE} bbox={ISRAEL} onClose={onClose} />, { wrapper: Wrapper });
  return { requests, onClose, queryClient };
}

const readout = (label: string) => screen.getByRole('status', { name: label }).textContent;

function save(name: string) {
  fireEvent.change(screen.getByRole('textbox', { name: new RegExp(COPY.AREAS.NAME_LABEL) }), {
    target: { value: name },
  });
  fireEvent.click(screen.getByRole('button', { name: COPY.AREAS.SAVE_SUBMIT }));
}

/** The server's area for SQUARE, `ratio` away from the client estimate. */
const savedWith = (ratio: number) => () =>
  jsonResponse(201, makeArea(AREA_ID, { name: 'Grove', areaKm2: estimate * (1 + ratio) }));

it('shows the estimate, then the server area in its place; no note within the ratio', async () => {
  const { requests } = renderDialog(savedWith(MAP.AREA_DIFF_WARN_RATIO / 2));
  expect(screen.getByRole('dialog', { name: COPY.AREAS.SAVE_TITLE })).toBeTruthy();
  expect(readout(COPY.AREAS.ESTIMATE_LABEL)).toBe(formatArea(estimate));

  save('  Grove  ');

  expect(await screen.findByRole('dialog', { name: COPY.AREAS.SAVED_TITLE })).toBeTruthy();
  const server = estimate * (1 + MAP.AREA_DIFF_WARN_RATIO / 2);
  expect(readout(COPY.AREAS.AREA_LABEL)).toBe(formatArea(server));
  expect(screen.queryByRole('status', { name: COPY.AREAS.ESTIMATE_LABEL })).toBeNull();
  expect(
    screen.queryByText(COPY.AREAS.AREA_DIFF_NOTE(formatArea(server), formatArea(estimate))),
  ).toBeNull();
  // The name is trimmed before it is sent; the ring goes as a GeoJSON polygon.
  expect(requests.find((request) => request.method === 'POST')?.body).toEqual({
    name: 'Grove',
    geometry: { type: 'Polygon', coordinates: [SQUARE] },
  });
});

it('adds one line with both values when they differ by more than the ratio', async () => {
  renderDialog(savedWith(MAP.AREA_DIFF_WARN_RATIO * 2));

  save('Grove');

  await screen.findByRole('dialog', { name: COPY.AREAS.SAVED_TITLE });
  const server = estimate * (1 + MAP.AREA_DIFF_WARN_RATIO * 2);
  expect(
    screen.getByText(COPY.AREAS.AREA_DIFF_NOTE(formatArea(server), formatArea(estimate))),
  ).toBeTruthy();
});

it("shows PostGIS's reason from a 422 and keeps the form", async () => {
  const reason = 'Self-intersection[34.95 32.05]';
  renderDialog(() =>
    jsonResponse(422, {
      code: ERROR_CODES.UNPROCESSABLE,
      message: ERROR_REASONS.INVALID_GEOMETRY,
      details: { reason },
    }),
  );

  save('Grove');

  const alert = await screen.findByRole('alert');
  expect(alert.textContent).toContain(COPY.AREAS.SAVE_ERROR_TITLE);
  expect(alert.textContent).toContain(reason);
  expect(screen.getByRole('button', { name: COPY.AREAS.SAVE_SUBMIT })).toBeTruthy();
});

it('asks for a name instead of sending one made of spaces', async () => {
  const { requests } = renderDialog(savedWith(0));

  save('   ');

  expect(await screen.findByText(COPY.AREAS.NAME_REQUIRED)).toBeTruthy();
  expect(requests.filter((request) => request.method === 'POST')).toEqual([]);
});

it('closes through Cancel and through Done after the save', async () => {
  const { onClose } = renderDialog(savedWith(0));
  fireEvent.click(screen.getByRole('button', { name: COPY.AREAS.CANCEL }));
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  cleanup();

  const second = renderDialog(savedWith(0));
  save('Grove');
  fireEvent.click(await screen.findByRole('button', { name: COPY.AREAS.DONE }));
  await waitFor(() => expect(second.onClose).toHaveBeenCalledTimes(1));
});
