// The leading '-' keeps the TanStack Router generator from treating this file as a route.
// /map end to end in jsdom: the real router, MapView, AreasLayer and overlays over a stubbed fetch.
import { COPY, DRAW, ERROR_CODES, ERROR_REASONS, MAP } from '@cgis/shared';
import { QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory } from '@tanstack/react-router';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import L from 'leaflet';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { FakeSocket } from '../lib/fake-websocket';
import { MAP_CLASS } from '../ui';
import { AppRouterProvider, createAppRouter } from '../router';
import {
  AREA_ID,
  deferred,
  jsonResponse,
  makeArea,
  makeVersion,
  queryWrapper,
  SQUARE,
  stubApi,
  stubDialogModal,
  type StubHandler,
  type StubRequest,
} from '../test/api-stub';

vi.mock('../lib/auth-client', () => ({
  authClient: {
    useSession: () => ({ data: { user: { id: 'user_1', name: 'Ada' } }, isPending: false }),
  },
}));

beforeAll(stubDialogModal);

beforeEach(() => {
  // jsdom has no layout; a zero-size map would report a degenerate bbox and fetch nothing.
  vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(800);
  vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(600);
  vi.stubGlobal('scrollTo', vi.fn());
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const orchard = makeArea(AREA_ID, { name: 'Orchard' });
const theirs = makeArea(AREA_ID, { name: 'Their orchard', version: 2 });

/** Renders the app at /map; returns the stub's requests and the Leaflet map MapView created. */
async function renderMap(handler: StubHandler) {
  const requests = stubApi(handler);
  const createMap = vi.spyOn(L, 'map');
  const { queryClient } = queryWrapper();
  const router = createAppRouter(queryClient, createMemoryHistory({ initialEntries: ['/map'] }));
  render(
    <QueryClientProvider client={queryClient}>
      <AppRouterProvider router={router} />
    </QueryClientProvider>,
  );
  await screen.findByTestId('map-root');
  const map = createMap.mock.results.at(-1)?.value;
  if (!(map instanceof L.Map)) throw new Error('MapView created no map');
  return { requests, map, queryClient };
}

const areaPaths = () => document.querySelectorAll(`.leaflet-${MAP.AREAS_PANE}-pane path`);

const isVersionsGet = ({ method, path }: StubRequest) =>
  method === 'GET' && path === `/api/areas/${AREA_ID}/versions`;

/** Answers the list with [orchard], its history with its one version, PUT with a 409 (`theirs`). */
const conflictingServer: StubHandler = (request) => {
  if (isVersionsGet(request)) return jsonResponse(200, { versions: [makeVersion(AREA_ID, 1)] });
  return request.method === 'PUT'
    ? jsonResponse(409, {
        code: ERROR_CODES.CONFLICT,
        message: ERROR_REASONS.VERSION_CONFLICT,
        details: { current: theirs },
      })
    : jsonResponse(200, { areas: [orchard] });
};

async function selectAndRename(name: string) {
  await waitFor(() => expect(areaPaths()).toHaveLength(1));
  areaPaths()[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  const panel = await screen.findByRole('region', { name: 'Orchard' });
  fireEvent.change(within(panel).getByRole('textbox'), { target: { value: name } });
  fireEvent.click(within(panel).getByRole('button', { name: COPY.AREAS.RENAME_SUBMIT }));
}

it('stacks the area panel and the presence list in one corner column, never on top of each other', async () => {
  const sockets: FakeSocket[] = [];
  vi.stubGlobal(
    'WebSocket',
    class extends FakeSocket {
      constructor(url: string) {
        super(url);
        sockets.push(this);
      }
    },
  );
  await renderMap(conflictingServer);
  const socket = sockets.at(-1);
  act(() => socket?.open());
  act(() =>
    socket?.receive({
      type: 'presence',
      seq: 1,
      ts: 1,
      payload: {
        users: [{ userId: 'user_1', name: 'Ada', color: MAP.PRESENCE_COLORS[0], state: 'viewing' }],
      },
    }),
  );
  await waitFor(() => expect(areaPaths()).toHaveLength(1));
  areaPaths()[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

  const panel = await screen.findByRole('region', { name: 'Orchard' });
  const presence = screen.getByRole('region', { name: COPY.PRESENCE.TITLE });
  const corner = screen.getByTestId('map-corner');
  // Neither overlay positions itself: both sit in the one column, the panel above the list.
  expect(panel.closest('.absolute')).toBe(corner);
  expect(presence.closest('.absolute')).toBe(corner);
  expect(panel.compareDocumentPosition(presence) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(within(panel).getByRole('button', { name: COPY.AREAS.RENAME_SUBMIT })).toBeTruthy();
});

it('loads the viewport with one GET: the first socket open does not refetch it', async () => {
  const sockets: FakeSocket[] = [];
  vi.stubGlobal(
    'WebSocket',
    class extends FakeSocket {
      constructor(url: string) {
        super(url);
        sockets.push(this);
      }
    },
  );
  const { requests } = await renderMap(conflictingServer);
  await waitFor(() => expect(areaPaths()).toHaveLength(1));
  await act(async () => sockets.at(-1)?.open());
  await act(async () => {});
  expect(requests.filter((request) => request.method === 'GET')).toHaveLength(1);
});

it('fetches the viewport and draws its areas in the areas pane', async () => {
  const { requests, map } = await renderMap(conflictingServer);

  await waitFor(() => expect(areaPaths()).toHaveLength(1));
  const bbox = requests[0]?.query.get('bbox')?.split(',').map(Number);
  const bounds = map.getBounds();
  expect(bbox?.[0]).toBeCloseTo(bounds.getWest(), 6);
  expect(bbox?.[3]).toBeCloseTo(bounds.getNorth(), 6);
});

it('opens ConflictDialog with the server copy on a 409; "Load theirs" shows their version', async () => {
  const { requests } = await renderMap(conflictingServer);

  await selectAndRename('Mine');

  const dialog = await screen.findByRole('alertdialog', { name: COPY.AREAS.CONFLICT_TITLE });
  expect(dialog.textContent).toContain('Their orchard');
  expect(requests.find((request) => request.method === 'PUT')?.body).toMatchObject({
    name: 'Mine',
    version: orchard.version,
  });

  fireEvent.click(within(dialog).getByRole('button', { name: COPY.AREAS.LOAD_THEIRS }));

  expect(await screen.findByRole('region', { name: 'Their orchard' })).toBeTruthy();
  expect(screen.queryByRole('alertdialog')).toBeNull();
});

it('"Overwrite with mine" resends the rename with the server version', async () => {
  const mine = makeArea(AREA_ID, { name: 'Mine', version: 3 });
  let puts = 0;
  const { requests } = await renderMap((request) => {
    if (request.method !== 'PUT') return jsonResponse(200, { areas: [orchard] });
    puts += 1;
    return puts === 1 ? conflictingServer(request) : jsonResponse(200, mine);
  });

  await selectAndRename('Mine');
  const dialog = await screen.findByRole('alertdialog', { name: COPY.AREAS.CONFLICT_TITLE });
  fireEvent.click(within(dialog).getByRole('button', { name: COPY.AREAS.OVERWRITE }));

  expect(await screen.findByRole('region', { name: 'Mine' })).toBeTruthy();
  const resent = requests.filter((request) => request.method === 'PUT')[1];
  expect(resent?.body).toMatchObject({ name: 'Mine', version: theirs.version });
});

it('opens the save dialog with the finished sketch on draw:done', async () => {
  const { map } = await renderMap(conflictingServer);

  // The draw control subscribes in an effect once the map is in state; its button means it ran.
  await screen.findByRole('button', { name: DRAW.START_LABEL });
  act(() => {
    map.fire('draw:done', { ring: SQUARE });
  });

  expect(await screen.findByRole('dialog', { name: COPY.AREAS.SAVE_TITLE })).toBeTruthy();
});

it("lists the viewport's areas; picking one selects and highlights it like a click on its polygon", async () => {
  await renderMap(conflictingServer);
  await waitFor(() => expect(areaPaths()).toHaveLength(1));

  const list = await screen.findByRole('region', { name: COPY.AREAS.LIST_TITLE });
  fireEvent.click(within(list).getByRole('button', { name: /Orchard/ }));

  const panel = await screen.findByRole('region', { name: 'Orchard' });
  expect(areaPaths()[0]?.classList.contains(MAP_CLASS.areaSelected)).toBe(true);
  fireEvent.click(within(panel).getByRole('button', { name: COPY.AREAS.CLOSE }));
  expect(await screen.findByRole('region', { name: COPY.AREAS.LIST_TITLE })).toBeTruthy();
  expect(areaPaths()[0]?.classList.contains(MAP_CLASS.areaSelected)).toBe(false);
});

it('reverts from the history: the panel shows the reverted area and the history reloads', async () => {
  const current = makeArea(AREA_ID, { name: 'Grove', version: 2 });
  const reverted = makeArea(AREA_ID, { name: 'Orchard', version: 3 });
  const history = [makeVersion(AREA_ID, 2, { name: 'Grove' }), makeVersion(AREA_ID, 1)];
  const { requests } = await renderMap((request) => {
    if (isVersionsGet(request)) return jsonResponse(200, { versions: history });
    if (request.method === 'POST') return jsonResponse(201, reverted);
    return jsonResponse(200, { areas: [current] });
  });
  await waitFor(() => expect(areaPaths()).toHaveLength(1));
  areaPaths()[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  const historyRegion = await screen.findByRole('region', { name: COPY.AREAS.HISTORY_TITLE });

  const [, first] = await within(historyRegion).findAllByRole('listitem');
  fireEvent.click(within(first!).getByRole('button', { name: COPY.AREAS.REVERT }));

  expect(await screen.findByRole('region', { name: 'Orchard' })).toBeTruthy();
  expect(requests.find((request) => request.method === 'POST')?.path).toBe(
    `/api/areas/${AREA_ID}/revert/1`,
  );
  await waitFor(() => expect(requests.filter(isVersionsGet)).toHaveLength(2));
});

it('leaves an area whose create is still pending out of the list (SaveDialog cancelled mid-save)', async () => {
  const response = deferred<Response>();
  const { map } = await renderMap((request) =>
    request.method === 'POST' ? response.promise : conflictingServer(request),
  );
  await waitFor(() => expect(areaPaths()).toHaveLength(1));
  await screen.findByRole('button', { name: DRAW.START_LABEL });
  act(() => {
    map.fire('draw:done', { ring: SQUARE });
  });
  const dialog = await screen.findByRole('dialog', { name: COPY.AREAS.SAVE_TITLE });
  fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Unsaved' } });
  fireEvent.click(within(dialog).getByRole('button', { name: COPY.AREAS.SAVE_SUBMIT }));
  await waitFor(() => expect(areaPaths()).toHaveLength(2));

  fireEvent.click(within(dialog).getByRole('button', { name: COPY.AREAS.CANCEL }));

  const list = await screen.findByRole('region', { name: COPY.AREAS.LIST_TITLE });
  expect(
    within(list)
      .getAllByRole('button')
      .map((row) => row.textContent),
  ).toEqual([expect.stringContaining('Orchard')]);
  expect(within(list).queryByText('Unsaved')).toBeNull();
});
