import { COPY, ERROR_CODES, ERROR_REASONS, type AreaList } from '@cgis/shared';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { formatArea } from '../lib/area-readout';
import { areasKey } from '../lib/areas-query';
import type { Bbox } from '@cgis/shared';
import {
  AREA_ID,
  emptyResponse,
  jsonResponse,
  makeArea,
  queryWrapper,
  stubApi,
  type StubHandler,
} from '../test/api-stub';
import { AreaPanel } from './AreaPanel';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ISRAEL: Bbox = [34.2, 29.5, 35.9, 33.3];
const orchard = makeArea(AREA_ID, { name: 'Orchard', version: 4 });

function renderPanel(handler: StubHandler) {
  const requests = stubApi(handler);
  const { queryClient, wrapper: Wrapper } = queryWrapper();
  queryClient.setQueryData<AreaList>(areasKey(ISRAEL), { areas: [orchard] });
  const props = { onClose: vi.fn(), onConflict: vi.fn(), onDeleted: vi.fn() };
  render(<AreaPanel area={orchard} {...props} />, { wrapper: Wrapper });
  const panel = screen.getByRole('region', { name: 'Orchard' });
  return { requests, queryClient, panel, ...props };
}

function rename(panel: HTMLElement, name: string) {
  fireEvent.change(within(panel).getByRole('textbox'), { target: { value: name } });
  fireEvent.click(within(panel).getByRole('button', { name: COPY.AREAS.RENAME_SUBMIT }));
}

it("shows the server's area and renames with the version it shows", async () => {
  const renamed = makeArea(AREA_ID, { name: 'Grove', version: 5 });
  const { panel, requests, queryClient } = renderPanel(() => jsonResponse(200, renamed));
  expect(within(panel).getByRole('status', { name: COPY.AREAS.AREA_LABEL }).textContent).toBe(
    formatArea(orchard.areaKm2),
  );

  rename(panel, 'Grove');

  await waitFor(() =>
    expect(queryClient.getQueryData(areasKey(ISRAEL))).toEqual({ areas: [renamed] }),
  );
  expect(requests[0]).toMatchObject({
    method: 'PUT',
    body: { name: 'Grove', geometry: orchard.geometry, version: 4 },
  });
});

it('hands a 409 to the parent instead of showing it', async () => {
  const theirs = makeArea(AREA_ID, { name: 'Theirs', version: 5 });
  const { panel, onConflict } = renderPanel(() =>
    jsonResponse(409, {
      code: ERROR_CODES.CONFLICT,
      message: ERROR_REASONS.VERSION_CONFLICT,
      details: { current: theirs },
    }),
  );

  rename(panel, 'Grove');

  await waitFor(() =>
    expect(onConflict).toHaveBeenCalledWith(
      { id: AREA_ID, body: { name: 'Grove', geometry: orchard.geometry, version: 4 } },
      theirs,
    ),
  );
  expect(screen.queryByRole('alert')).toBeNull();
});

it('deletes the area and reports it; a failed delete shows an alert', async () => {
  const ok = renderPanel(() => emptyResponse(204));
  fireEvent.click(within(ok.panel).getByRole('button', { name: COPY.AREAS.DELETE }));
  await waitFor(() => expect(ok.onDeleted).toHaveBeenCalledTimes(1));
  expect(ok.requests[0]).toMatchObject({ method: 'DELETE', path: `/api/areas/${AREA_ID}` });
  expect(ok.queryClient.getQueryData(areasKey(ISRAEL))).toEqual({ areas: [] });
  cleanup();

  const failing = renderPanel(() =>
    jsonResponse(429, { code: ERROR_CODES.RATE_LIMITED, message: 'Slow' }),
  );
  fireEvent.click(within(failing.panel).getByRole('button', { name: COPY.AREAS.DELETE }));
  const alert = await screen.findByRole('alert');
  expect(alert.textContent).toContain(COPY.AREAS.DELETE_ERROR_TITLE);
  expect(alert.textContent).toContain('Slow');
  expect(failing.onDeleted).not.toHaveBeenCalled();
});

it('asks for a name instead of sending one made of spaces; Close closes', () => {
  const { panel, requests, onClose } = renderPanel(() => jsonResponse(500, {}));

  rename(panel, '   ');
  expect(within(panel).getByText(COPY.AREAS.NAME_REQUIRED)).toBeTruthy();
  expect(requests).toEqual([]);

  fireEvent.click(within(panel).getByRole('button', { name: COPY.AREAS.CLOSE }));
  expect(onClose).toHaveBeenCalledTimes(1);
});
