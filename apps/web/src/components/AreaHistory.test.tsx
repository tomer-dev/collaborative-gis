import { COPY, ERROR_CODES, ERROR_REASONS, LIMITS, type AreaList, type Bbox } from '@cgis/shared';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { formatArea } from '../lib/area-readout';
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
const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

const isVersionsGet = ({ method, path }: StubRequest) =>
  method === 'GET' && path === `/api/areas/${AREA_ID}/versions`;
const posts = (requests: StubRequest[]) => requests.filter(({ method }) => method === 'POST');

/** Renders the history of `area` over a server that lists `versions` and answers POST with `post`. */
function renderHistory(post: () => Response | Promise<Response> = () => jsonResponse(500, {})) {
  const requests = stubApi((request) =>
    isVersionsGet(request) ? jsonResponse(200, { versions }) : post(),
  );
  const { queryClient, wrapper } = queryWrapper();
  queryClient.setQueryData<AreaList>(areasKey(ISRAEL), { areas: [area] });
  render(<AreaHistory area={area} />, { wrapper });
  const history = screen.getByRole('region', { name: COPY.AREAS.HISTORY_TITLE });
  return { requests, queryClient, history };
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
  expect(newest?.textContent).toContain(relative.format(-30, 'second'));
  expect(newest?.textContent).toContain(COPY.AREAS.VERSION_CURRENT);
  expect(within(newest!).queryByRole('button')).toBeNull();

  expect(middle?.textContent).toContain(COPY.AREAS.VERSION_LABEL(2));
  expect(middle?.textContent).toContain(formatArea(0.5));
  expect(middle?.textContent).toContain(relative.format(-5, 'minute'));
  expect(oldest?.textContent).toContain(COPY.AREAS.VERSION_LABEL(1));
  expect(oldest?.textContent).toContain(formatArea(2.25));
  expect(oldest?.textContent).toContain(relative.format(-2, 'day'));
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
  expect(posts(requests)).toEqual([
    expect.objectContaining({ path: `/api/areas/${AREA_ID}/revert/1` }),
  ]);

  response.resolve(jsonResponse(201, reverted));

  await waitFor(() =>
    expect(queryClient.getQueryData(areasKey(ISRAEL))).toEqual({ areas: [reverted] }),
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
  render(<AreaHistory area={area} />, { wrapper });

  const alert = await screen.findByRole('alert');
  expect(alert.textContent).toContain(COPY.AREAS.HISTORY_ERROR_TITLE);
  expect(alert.textContent).toContain('Internal error');
});
