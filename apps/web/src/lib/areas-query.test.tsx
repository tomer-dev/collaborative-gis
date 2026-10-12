import {
  ERROR_CODES,
  ERROR_REASONS,
  QUERY,
  type Area,
  type AreaCreate,
  type AreaList,
} from '@cgis/shared';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AREA_ID,
  deferred,
  emptyResponse,
  jsonResponse,
  makeArea,
  OTHER_ID,
  queryWrapper,
  SQUARE,
  stubApi,
} from '../test/api-stub';
import { ApiRequestError } from './api-client';
import {
  AreaConflictError,
  areasKey,
  replaceArea,
  useAreasInBounds,
  useCreateArea,
  useDeleteArea,
  useUpdateArea,
} from './areas-query';
import { ringAreaKm2 } from './geo/geodesic';
import type { Bbox } from '@cgis/shared';

vi.mock('./auth-client', () => ({
  authClient: {
    useSession: () => ({ data: { user: { id: 'user_1', name: 'Ada' } }, isPending: false }),
  },
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ISRAEL: Bbox = [34.2, 29.5, 35.9, 33.3];
const HAIFA: Bbox = [34.9, 32.7, 35.1, 32.9];
// What MapView reports for a zero-size container: west === east.
const DEGENERATE: Bbox = [35, 31.5, 35, 31.5];

const orchard = makeArea(AREA_ID);
const vineyard = makeArea(OTHER_ID, { name: 'Vineyard' });

/** Answers `GET /api/areas` with `areas`, and anything else with `other`. */
function listing(
  areas: Area[],
  other?: (path: string, method: string) => Response | Promise<Response>,
) {
  return stubApi(({ method, path }) =>
    method === 'GET' && path === '/api/areas'
      ? jsonResponse(200, { areas })
      : (other?.(path, method) ?? jsonResponse(500, {})),
  );
}

describe('useAreasInBounds', () => {
  it('keys the query by the bbox and fetches each new one; a degenerate or null bbox fetches nothing', async () => {
    const requests = listing([orchard]);
    const { queryClient, wrapper } = queryWrapper();
    const initialProps: { bbox: Bbox | null } = { bbox: ISRAEL };
    const { result, rerender } = renderHook(({ bbox }) => useAreasInBounds(bbox), {
      wrapper,
      initialProps,
    });

    await waitFor(() => expect(result.current.data).toEqual({ areas: [orchard] }));
    expect(requests.map((request) => request.query.get('bbox'))).toEqual([ISRAEL.join(',')]);

    rerender({ bbox: HAIFA });
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1]?.query.get('bbox')).toBe(HAIFA.join(','));
    const keys = queryClient.getQueryCache().findAll({ queryKey: [QUERY.AREAS_KEY] });
    expect(keys.map((query) => query.queryKey)).toEqual([areasKey(ISRAEL), areasKey(HAIFA)]);

    rerender({ bbox: DEGENERATE });
    rerender({ bbox: null });
    await act(async () => {});
    expect(requests).toHaveLength(2);
    expect(queryClient.getQueryState(areasKey(DEGENERATE))?.fetchStatus).toBe('idle');
    expect(queryClient.getQueryState(areasKey(null))?.fetchStatus).toBe('idle');
  });

  it('rejects a list that does not match the shared schema', async () => {
    stubApi(() => jsonResponse(200, { areas: [{ ...orchard, version: 0 }] }));
    const { wrapper } = queryWrapper();
    const { result } = renderHook(() => useAreasInBounds(ISRAEL), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe('useCreateArea', () => {
  const input: AreaCreate = { name: 'Grove', geometry: { type: 'Polygon', coordinates: [SQUARE] } };

  function renderCreate(post: () => Promise<Response>) {
    const requests = listing([orchard], (path, method) =>
      method === 'POST' && path === '/api/areas' ? post() : jsonResponse(500, {}),
    );
    const { queryClient, wrapper } = queryWrapper();
    queryClient.setQueryData<AreaList>(areasKey(ISRAEL), { areas: [orchard] });
    const view = renderHook(() => useCreateArea(ISRAEL), { wrapper });
    const cached = () => queryClient.getQueryData<AreaList>(areasKey(ISRAEL))?.areas;
    return { ...view, requests, cached };
  }

  it('adds the area to the viewport at once, then rolls it back on a 422 and exposes details.reason', async () => {
    const response = deferred<Response>();
    const { result, cached, requests } = renderCreate(() => response.promise);

    act(() => result.current.mutate(input));

    await waitFor(() => expect(cached()).toHaveLength(2));
    const optimistic = cached()?.[1];
    expect(optimistic).toMatchObject({ name: 'Grove', version: 1, createdBy: 'user_1' });
    expect(optimistic?.areaKm2).toBeCloseTo(ringAreaKm2(SQUARE), 9);
    expect(requests.find((request) => request.method === 'POST')?.body).toEqual(input);

    const reason = 'Self-intersection[34.95 32.05]';
    response.resolve(
      jsonResponse(422, {
        code: ERROR_CODES.UNPROCESSABLE,
        message: ERROR_REASONS.INVALID_GEOMETRY,
        details: { reason },
      }),
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(cached()).toEqual([orchard]);
    const error = result.current.error;
    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error instanceof ApiRequestError && error.reason).toBe(reason);
    expect(error instanceof ApiRequestError && error.status).toBe(422);
  });

  it("puts the server's area in place of the optimistic one", async () => {
    const saved = makeArea(OTHER_ID, { name: 'Grove', areaKm2: 104.95 });
    const { result, cached } = renderCreate(async () => jsonResponse(201, saved));

    act(() => result.current.mutate(input));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(saved);
    expect(cached()).toEqual([orchard, saved]);
  });
});

describe('useUpdateArea', () => {
  const edit = {
    id: AREA_ID,
    body: { name: 'Mine', geometry: orchard.geometry, version: 1 },
  };

  it('rejects a 409 with AreaConflictError carrying details.current, without retrying', async () => {
    const theirs = makeArea(AREA_ID, { name: 'Theirs', version: 2 });
    const requests = stubApi(() =>
      jsonResponse(409, {
        code: ERROR_CODES.CONFLICT,
        message: ERROR_REASONS.VERSION_CONFLICT,
        details: { current: theirs },
      }),
    );
    const { wrapper } = queryWrapper();
    const { result } = renderHook(() => useUpdateArea(), { wrapper });

    act(() => result.current.mutate(edit));

    await waitFor(() => expect(result.current.isError).toBe(true));
    const error = result.current.error;
    expect(error).toBeInstanceOf(AreaConflictError);
    expect(error instanceof AreaConflictError && error.current).toEqual(theirs);
    expect(requests).toEqual([
      expect.objectContaining({ method: 'PUT', path: `/api/areas/${AREA_ID}`, body: edit.body }),
    ]);
  });

  it("puts the server's copy in every cached viewport that has the area", async () => {
    const renamed = makeArea(AREA_ID, { name: 'Mine', version: 2 });
    stubApi(() => jsonResponse(200, renamed));
    const { queryClient, wrapper } = queryWrapper();
    queryClient.setQueryData<AreaList>(areasKey(ISRAEL), { areas: [orchard, vineyard] });
    queryClient.setQueryData<AreaList>(areasKey(HAIFA), { areas: [orchard] });
    const { result } = renderHook(() => useUpdateArea(), { wrapper });

    act(() => result.current.mutate(edit));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(queryClient.getQueryData(areasKey(ISRAEL))).toEqual({ areas: [renamed, vineyard] });
    expect(queryClient.getQueryData(areasKey(HAIFA))).toEqual({ areas: [renamed] });
  });
});

describe('useDeleteArea', () => {
  it('drops the area from every cached viewport after the 204', async () => {
    const requests = stubApi(() => emptyResponse(204));
    const { queryClient, wrapper } = queryWrapper();
    queryClient.setQueryData<AreaList>(areasKey(ISRAEL), { areas: [orchard, vineyard] });
    queryClient.setQueryData<AreaList>(areasKey(HAIFA), { areas: [orchard] });
    const { result } = renderHook(() => useDeleteArea(), { wrapper });

    act(() => result.current.mutate(AREA_ID));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(requests[0]).toMatchObject({ method: 'DELETE', path: `/api/areas/${AREA_ID}` });
    expect(queryClient.getQueryData(areasKey(ISRAEL))).toEqual({ areas: [vineyard] });
    expect(queryClient.getQueryData(areasKey(HAIFA))).toEqual({ areas: [] });
  });

  it('reads an error body that is not an ApiError as INTERNAL', async () => {
    stubApi(() => new Response('<html>Bad gateway</html>', { status: 502 }));
    const { wrapper } = queryWrapper();
    const { result } = renderHook(() => useDeleteArea(), { wrapper });

    act(() => result.current.mutate(AREA_ID));

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toMatchObject({ status: 502, code: ERROR_CODES.INTERNAL });
  });
});

it('replaceArea swaps the area by id in every viewport and leaves the others', () => {
  const { queryClient } = queryWrapper();
  queryClient.setQueryData<AreaList>(areasKey(ISRAEL), { areas: [orchard, vineyard] });
  queryClient.setQueryData<AreaList>(areasKey(HAIFA), { areas: [vineyard] });
  const theirs = makeArea(AREA_ID, { name: 'Theirs', version: 3 });

  replaceArea(queryClient, theirs);

  expect(queryClient.getQueryData(areasKey(ISRAEL))).toEqual({ areas: [theirs, vineyard] });
  expect(queryClient.getQueryData(areasKey(HAIFA))).toEqual({ areas: [vineyard] });
});
