import {
  COPY,
  ERROR_CODES,
  ERROR_REASONS,
  LIMITS,
  type Area,
  type AreaList,
  type Bbox,
} from '@cgis/shared';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { formatArea } from '../lib/area-readout';
import type { AreaEdit } from '../lib/areas-mutations';
import { areasKey } from '../lib/areas-query';
import {
  AREA_ID,
  deferred,
  jsonResponse,
  makeArea,
  makeVersion,
  queryWrapper,
  stubApi,
  type StubRequest,
  ZOOM,
} from '../test/api-stub';
import { AreaHistory } from './AreaHistory';

const NOW = new Date('2026-10-12T12:00:00.000Z');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const ISRAEL: Bbox = [34.2, 29.5, 35.9, 33.3];
const EDITOR = 'user_2zyxwvutsrqpon';
const area = makeArea(AREA_ID, { name: 'Orchard v3', version: 3 });
const versions = [
  makeVersion(AREA_ID, 3, { changedAt: '2026-10-12T11:59:30.000Z', changedBy: EDITOR }),
  makeVersion(AREA_ID, 2, { changedAt: '2026-10-12T11:55:00.000Z', areaKm2: 0.5 }),
  makeVersion(AREA_ID, 1, { changedAt: '2026-10-10T12:00:00.000Z', areaKm2: 2.25 }),
];

const isVersionsGet = ({ method, path }: StubRequest) =>
  method === 'GET' && path === `/api/areas/${AREA_ID}/versions`;
const posts = (requests: StubRequest[]) => requests.filter(({ method }) => method === 'POST');

/** Renders the history of `area` over a server that lists `versions` and answers POST with `post`. */
function renderHistory(post: () => Response | Promise<Response> = () => jsonResponse(500, {})) {
  const requests = stubApi((request) =>
    isVersionsGet(request) ? jsonResponse(200, { versions }) : post(),
  );
  const { queryClient, wrapper } = queryWrapper();
  queryClient.setQueryData<AreaList>(areasKey(ISRAEL, ZOOM), { areas: [area] });
  const onConflict = vi.fn<(edit: AreaEdit, current: Area) => void>();
  render(<AreaHistory area={area} onConflict={onConflict} />, { wrapper });
  const history = screen.getByRole('region', { name: COPY.AREAS.HISTORY_TITLE });
  return { requests, queryClient, history, onConflict };
}

const rows = async (history: HTMLElement) => {
  await within(history).findByText(COPY.AREAS.VERSION_LABEL(1));
  return within(history).getAllByRole('listitem');
};

it("lists the versions newest first: number, name, area, who and when; the area's own version has no revert", async () => {
  const { history } = renderHistory();
  expect(within(history).getByText(COPY.AREAS.HISTORY_LOADING)).toBeTruthy();

  const [newest, middle, oldest] = await rows(history);

  expect(newest?.textContent).toContain(COPY.AREAS.VERSION_LABEL(3));
  expect(newest?.textContent).toContain('Orchard v3');
  expect(newest?.textContent).toContain(formatArea(104.97));
  expect(newest?.textContent).toContain(
    COPY.AREAS.VERSION_BY(EDITOR.slice(0, LIMITS.USER_ID_PREFIX)),
  );
  // date-fns formatDistanceToNow: 30 s rounds to a minute.
  expect(newest?.textContent).toContain('1 minute ago');
  expect(newest?.textContent).toContain(COPY.AREAS.VERSION_CURRENT);
  expect(within(newest!).queryByRole('button')).toBeNull();

  expect(middle?.textContent).toContain(COPY.AREAS.VERSION_LABEL(2));
  expect(middle?.textContent).toContain(formatArea(0.5));
  expect(middle?.textContent).toContain('5 minutes ago');
  expect(oldest?.textContent).toContain(COPY.AREAS.VERSION_LABEL(1));
  expect(oldest?.textContent).toContain(formatArea(2.25));
  expect(oldest?.textContent).toContain('2 days ago');
  // The exact time is the tooltip, and the machine-readable value the ISO string.
  const { changedAt } = versions[2]!;
  const time = oldest!.querySelector('time');
  expect(time?.dateTime).toBe(changedAt);
  expect(time?.title).toBe(
    new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
      Date.parse(changedAt),
    ),
  );
  expect(within(oldest!).getByRole('button', { name: COPY.AREAS.REVERT })).toBeTruthy();
});

it('reverts to the chosen version and patches the 201 area into the cache', async () => {
  const response = deferred<Response>();
  const reverted = makeArea(AREA_ID, { name: 'Orchard v1', version: 4 });
  const { history, requests, queryClient } = renderHistory(() => response.promise);
  const [, middle, oldest] = await rows(history);

  fireEvent.click(within(oldest!).getByRole('button', { name: COPY.AREAS.REVERT }));

  // One revert at a time: every revert button waits for this one.
  await within(oldest!).findByRole('button', { name: COPY.AREAS.REVERT_PENDING });
  expect(within(middle!).getByRole('button', { name: COPY.AREAS.REVERT })).toHaveProperty(
    'disabled',
    true,
  );
  // The body names the version this panel shows (D4): a newer one stored is a 409.
  expect(posts(requests)).toEqual([
    expect.objectContaining({ path: `/api/areas/${AREA_ID}/revert/1`, body: { version: 3 } }),
  ]);

  response.resolve(jsonResponse(201, reverted));

  await waitFor(() =>
    expect(queryClient.getQueryData(areasKey(ISRAEL, ZOOM))).toEqual({ areas: [reverted] }),
  );
  expect(screen.queryByRole('alert')).toBeNull();
});

it('says the area is deleted on a 409', async () => {
  const { history } = renderHistory(() =>
    jsonResponse(409, {
      code: ERROR_CODES.CONFLICT,
      message: 'Conflict',
      details: { reason: ERROR_REASONS.AREA_DELETED },
    }),
  );
  const [, middle] = await rows(history);

  fireEvent.click(within(middle!).getByRole('button', { name: COPY.AREAS.REVERT }));

  const alert = await within(history).findByRole('alert');
  expect(alert.textContent).toContain(COPY.AREAS.REVERT_ERROR_TITLE);
  expect(alert.textContent).toContain(COPY.AREAS.REVERT_DELETED);
});

it('a revert met by a newer version hands the conflict to the parent (ConflictDialog)', async () => {
  const theirs = makeArea(AREA_ID, { name: 'Renamed by someone', version: 4 });
  const { history, onConflict } = renderHistory(() =>
    jsonResponse(409, {
      code: ERROR_CODES.CONFLICT,
      message: ERROR_REASONS.VERSION_CONFLICT,
      details: { current: theirs },
    }),
  );
  const [, , oldest] = await rows(history);

  fireEvent.click(within(oldest!).getByRole('button', { name: COPY.AREAS.REVERT }));

  // "Overwrite with mine" then saves version 1's name and geometry on top of theirs.
  const v1 = versions[2]!;
  await waitFor(() =>
    expect(onConflict).toHaveBeenCalledExactlyOnceWith(
      { id: AREA_ID, body: { name: v1.name, geometry: v1.geometry, version: 3 } },
      theirs,
    ),
  );
  expect(within(history).queryByRole('alert')).toBeNull();
});

it('refetches the history and says so on a 404', async () => {
  const { history, requests } = renderHistory(() =>
    jsonResponse(404, { code: ERROR_CODES.NOT_FOUND, message: 'Not found' }),
  );
  const [, middle] = await rows(history);

  fireEvent.click(within(middle!).getByRole('button', { name: COPY.AREAS.REVERT }));

  const alert = await within(history).findByRole('alert');
  expect(alert.textContent).toContain(COPY.AREAS.REVERT_MISSING);
  await waitFor(() => expect(requests.filter(isVersionsGet)).toHaveLength(2));
});

it('shows a failed history load', async () => {
  stubApi(() => jsonResponse(500, { code: ERROR_CODES.INTERNAL, message: 'Internal error' }));
  const { wrapper } = queryWrapper();
  render(<AreaHistory area={area} onConflict={() => {}} />, { wrapper });

  const alert = await screen.findByRole('alert');
  expect(alert.textContent).toContain(COPY.AREAS.HISTORY_ERROR_TITLE);
  expect(alert.textContent).toContain('Internal error');
});
