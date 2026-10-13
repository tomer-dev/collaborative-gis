import {
  COPY,
  ERROR_CODES,
  ERROR_REASONS,
  type Area,
  type AreaList,
  type Bbox,
} from '@cgis/shared';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { formatArea } from '../lib/area-readout';
import { areasKey } from '../lib/areas-query';
import {
  AREA_ID,
  emptyResponse,
  jsonResponse,
  makeArea,
  makeVersion,
  OTHER_ID,
  queryWrapper,
  stubApi,
  type StubHandler,
  type StubRequest,
  ZOOM,
} from '../test/api-stub';
import { AreaPanel, type AreaPanelProps } from './AreaPanel';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ISRAEL: Bbox = [34.2, 29.5, 35.9, 33.3];
const orchard = makeArea(AREA_ID, { name: 'Orchard', version: 4 });
/** A square near Berlin: in the cached list (a WebSocket append), outside the viewport. */
const berlin = makeArea(OTHER_ID, {
  name: 'Berlin',
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [13.3, 52.5],
        [13.4, 52.5],
        [13.4, 52.6],
        [13.3, 52.6],
        [13.3, 52.5],
      ],
    ],
  },
});
const NO_PENDING: ReadonlySet<string> = new Set();

const isVersionsGet = ({ method, path }: StubRequest) =>
  method === 'GET' && path.endsWith('/versions');
const writes = (requests: StubRequest[]) => requests.filter((request) => !isVersionsGet(request));

/** Renders the panel; GET versions answers one version, every other request goes to `handler`. */
function renderPanel(handler: StubHandler, props: Partial<AreaPanelProps> = {}) {
  const requests = stubApi((request) =>
    isVersionsGet(request)
      ? jsonResponse(200, { versions: [makeVersion(AREA_ID, 4)] })
      : handler(request),
  );
  const { queryClient, wrapper: Wrapper } = queryWrapper();
  queryClient.setQueryData<AreaList>(areasKey(ISRAEL, ZOOM), { areas: [orchard] });
  const callbacks = {
    onSelect: vi.fn(),
    onClose: vi.fn(),
    onConflict: vi.fn(),
    onDeleted: vi.fn(),
  };
  const view = render(
    <AreaPanel
      areas={[orchard]}
      bbox={ISRAEL}
      pendingIds={NO_PENDING}
      selectedId={AREA_ID}
      {...callbacks}
      {...props}
    />,
    { wrapper: Wrapper },
  );
  return { requests, queryClient, ...view, ...callbacks };
}

/** The selected area's panel, named by the area. */
const selectedPanel = (name = 'Orchard') => screen.getByRole('region', { name });
const listPanel = () => screen.getByRole('region', { name: COPY.AREAS.LIST_TITLE });

function rename(panel: HTMLElement, name: string) {
  fireEvent.change(within(panel).getByRole('textbox'), { target: { value: name } });
  fireEvent.click(within(panel).getByRole('button', { name: COPY.AREAS.RENAME_SUBMIT }));
}

it('lists only the areas in the viewport with name and area', () => {
  const inView = [1, 2].map((km2) =>
    makeArea(`area-${km2}`, { name: `Field ${km2}`, areaKm2: km2 }),
  );
  renderPanel(() => jsonResponse(500, {}), { areas: [berlin, ...inView], selectedId: null });

  const rows = within(listPanel()).getAllByRole('listitem');
  expect(rows).toHaveLength(2);
  expect(rows[0]?.textContent).toContain('Field 1');
  expect(rows[0]?.textContent).toContain(formatArea(1));
  expect(within(listPanel()).queryByText('Berlin')).toBeNull();
});

it('says when no saved area is in view', () => {
  renderPanel(() => jsonResponse(500, {}), { areas: [berlin], selectedId: null });

  expect(within(listPanel()).getByText(COPY.AREAS.LIST_EMPTY)).toBeTruthy();
  expect(within(listPanel()).queryByRole('listitem')).toBeNull();
});

it('selects a listed area through onSelect; the selected area replaces the list', () => {
  const vineyard = makeArea('area-v', { name: 'Vineyard' });
  const { onSelect, rerender } = renderPanel(() => jsonResponse(500, {}), {
    areas: [orchard, vineyard],
    selectedId: null,
  });

  fireEvent.click(within(listPanel()).getByRole('button', { name: /Vineyard/ }));
  expect(onSelect).toHaveBeenCalledWith(vineyard);

  rerender(
    <AreaPanel
      areas={[orchard, vineyard]}
      bbox={ISRAEL}
      pendingIds={NO_PENDING}
      selectedId={vineyard.id}
      onSelect={onSelect}
      onClose={vi.fn()}
      onConflict={vi.fn()}
      onDeleted={vi.fn()}
    />,
  );
  expect(selectedPanel('Vineyard')).toBeTruthy();
  expect(screen.queryByRole('region', { name: COPY.AREAS.LIST_TITLE })).toBeNull();
});

it('never lists or opens an area whose create is still pending', async () => {
  const optimistic = makeArea('temp-id', { name: 'Unsaved' });
  const { requests } = renderPanel(() => jsonResponse(500, {}), {
    areas: [orchard, optimistic],
    pendingIds: new Set([optimistic.id]),
    selectedId: optimistic.id,
  });

  expect(screen.queryByRole('region', { name: 'Unsaved' })).toBeNull();
  const rows = within(listPanel()).getAllByRole('listitem');
  expect(rows.map((row) => row.textContent)).toEqual([expect.stringContaining('Orchard')]);
  await Promise.resolve();
  expect(requests).toEqual([]);
});

it("shows the server's area and renames with the version it shows", async () => {
  const renamed = makeArea(AREA_ID, { name: 'Grove', version: 5 });
  const { requests, queryClient } = renderPanel(() => jsonResponse(200, renamed));
  const panel = selectedPanel();
  expect(within(panel).getByRole('status', { name: COPY.AREAS.AREA_LABEL }).textContent).toBe(
    formatArea(orchard.areaKm2),
  );

  rename(panel, 'Grove');

  await waitFor(() =>
    expect(queryClient.getQueryData(areasKey(ISRAEL, ZOOM))).toEqual({ areas: [renamed] }),
  );
  expect(writes(requests)[0]).toMatchObject({
    method: 'PUT',
    body: { name: 'Grove', geometry: orchard.geometry, version: 4 },
  });
});

it('hands a 409 to the parent instead of showing it', async () => {
  const theirs = makeArea(AREA_ID, { name: 'Theirs', version: 5 });
  const { onConflict } = renderPanel(() =>
    jsonResponse(409, {
      code: ERROR_CODES.CONFLICT,
      message: ERROR_REASONS.VERSION_CONFLICT,
      details: { current: theirs },
    }),
  );

  rename(selectedPanel(), 'Grove');

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
  fireEvent.click(within(selectedPanel()).getByRole('button', { name: COPY.AREAS.DELETE }));
  await waitFor(() => expect(ok.onDeleted).toHaveBeenCalledTimes(1));
  expect(writes(ok.requests)[0]).toMatchObject({
    method: 'DELETE',
    path: `/api/areas/${AREA_ID}`,
  });
  expect(ok.queryClient.getQueryData(areasKey(ISRAEL, ZOOM))).toEqual({ areas: [] });
  cleanup();

  const failing = renderPanel(() =>
    jsonResponse(429, { code: ERROR_CODES.RATE_LIMITED, message: 'Slow' }),
  );
  fireEvent.click(within(selectedPanel()).getByRole('button', { name: COPY.AREAS.DELETE }));
  const alert = await screen.findByRole('alert');
  expect(alert.textContent).toContain(COPY.AREAS.DELETE_ERROR_TITLE);
  expect(alert.textContent).toContain('Slow');
  expect(failing.onDeleted).not.toHaveBeenCalled();
});

it('asks for a name instead of sending one made of spaces; Close closes', () => {
  const { requests, onClose } = renderPanel(() => jsonResponse(500, {}));
  const panel = selectedPanel();

  rename(panel, '   ');
  expect(within(panel).getByText(COPY.AREAS.NAME_REQUIRED)).toBeTruthy();
  expect(writes(requests)).toEqual([]);

  fireEvent.click(within(panel).getByRole('button', { name: COPY.AREAS.CLOSE }));
  expect(onClose).toHaveBeenCalledTimes(1);
});

it("refills the name field when the area's name changes (a revert, another user's rename)", () => {
  const props = {
    bbox: ISRAEL,
    pendingIds: NO_PENDING,
    selectedId: AREA_ID,
    onSelect: vi.fn(),
    onClose: vi.fn(),
    onConflict: vi.fn(),
    onDeleted: vi.fn(),
  };
  const { rerender } = renderPanel(() => jsonResponse(500, {}));
  const reverted: Area = { ...orchard, name: 'Old orchard', version: 5 };

  rerender(<AreaPanel areas={[reverted]} {...props} />);

  const field = within(selectedPanel('Old orchard')).getByRole('textbox');
  expect(field).toHaveProperty('value', 'Old orchard');
});
