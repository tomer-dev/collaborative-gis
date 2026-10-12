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
  makeVersion,
  OTHER_ID,
  queryWrapper,
  SQUARE,
  stubApi,
  ZOOM,
} from '../test/api-stub';
import { ApiRequestError } from './api-client';
import {
  AreaConflictError,
  areasKey,
  replaceArea,
  useAreasInBounds,
  useAreaVersions,
  useCreateArea,
  useDeleteArea,
  usePendingAreaIds,
  useRevertArea,
  useUpdateArea,
  versionsKey,
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
    const { result, rerender } = renderHook(({ bbox }) => useAreasInBounds(bbox, ZOOM), {
      wrapper,
      initialProps,
    });

    await waitFor(() => expect(result.current.data).toEqual({ areas: [orchard] }));
    expect(requests.map((request) => request.query.get('bbox'))).toEqual([ISRAEL.join(',')]);

    rerender({ bbox: HAIFA });
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1]?.query.get('bbox')).toBe(HAIFA.join(','));
    const keys = queryClient.getQueryCache().findAll({ queryKey: [QUERY.AREAS_KEY] });
    expect(keys.map((query) => query.queryKey)).toEqual([
      areasKey(ISRAEL, ZOOM),
      areasKey(HAIFA, ZOOM),
    ]);

    rerender({ bbox: DEGENERATE });
    rerender({ bbox: null });
    await act(async () => {});
    expect(requests).toHaveLength(2);
    expect(queryClient.getQueryState(areasKey(DEGENERATE, ZOOM))?.fetchStatus).toBe('idle');
    expect(queryClient.getQueryState(areasKey(null, ZOOM))?.fetchStatus).toBe('idle');
  });

  it("sends the map's zoom with the bbox and keys the viewport by both", async () => {
    const requests = listing([orchard]);
    const { queryClient, wrapper } = queryWrapper();
    const { result, rerender } = renderHook(({ zoom }) => useAreasInBounds(ISRAEL, zoom), {
      wrapper,
      initialProps: { zoom: ZOOM },
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    rerender({ zoom: ZOOM + 1 });
    await waitFor(() => expect(requests).toHaveLength(2));

    expect(requests.map((request) => request.query.get('zoom'))).toEqual([
      String(ZOOM),
      String(ZOOM + 1),
    ]);
    const keys = queryClient.getQueryCache().findAll({ queryKey: [QUERY.AREAS_KEY] });
    expect(keys.map((query) => query.queryKey)).toEqual([
      [QUERY.AREAS_KEY, ISRAEL, ZOOM],
      [QUERY.AREAS_KEY, ISRAEL, ZOOM + 1],
    ]);
  });

  it('rejects a list that does not match the shared schema', async () => {
    stubApi(() => jsonResponse(200, { areas: [{ ...orchard, version: 0 }] }));
    const { wrapper } = queryWrapper();
    const { result } = renderHook(() => useAreasInBounds(ISRAEL, ZOOM), { wrapper });

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
    queryClient.setQueryData<AreaList>(areasKey(ISRAEL, ZOOM), { areas: [orchard] });
    const view = renderHook(() => useCreateArea(ISRAEL, ZOOM), { wrapper });
    const cached = () => queryClient.getQueryData<AreaList>(areasKey(ISRAEL, ZOOM))?.areas;
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

  it('lists the optimistic area as pending until the server answers', async () => {
    const response = deferred<Response>();
    const requests = listing([orchard], (path, method) =>
      method === 'POST' && path === '/api/areas' ? response.promise : jsonResponse(500, {}),
    );
    const { queryClient, wrapper } = queryWrapper();
    queryClient.setQueryData<AreaList>(areasKey(ISRAEL, ZOOM), { areas: [orchard] });
    const { result } = renderHook(
      () => ({ create: useCreateArea(ISRAEL, ZOOM), pending: usePendingAreaIds() }),
      { wrapper },
    );

    act(() => result.current.create.mutate(input));
    await waitFor(() => expect(result.current.pending.size).toBe(1));
    const tempId = queryClient.getQueryData<AreaList>(areasKey(ISRAEL, ZOOM))?.areas[1]?.id;
    expect(tempId && result.current.pending.has(tempId)).toBe(true);
    expect(requests.some((request) => request.method === 'POST')).toBe(true);

    response.resolve(jsonResponse(201, makeArea(OTHER_ID, { name: 'Grove' })));
    await waitFor(() => expect(result.current.pending.size).toBe(0));
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
    queryClient.setQueryData<AreaList>(areasKey(ISRAEL, ZOOM), { areas: [orchard, vineyard] });
    queryClient.setQueryData<AreaList>(areasKey(HAIFA, ZOOM), { areas: [orchard] });
    const { result } = renderHook(() => useUpdateArea(), { wrapper });

    act(() => result.current.mutate(edit));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(queryClient.getQueryData(areasKey(ISRAEL, ZOOM))).toEqual({
      areas: [renamed, vineyard],
    });
    expect(queryClient.getQueryData(areasKey(HAIFA, ZOOM))).toEqual({ areas: [renamed] });
  });
});

describe('useDeleteArea', () => {
  it('drops the area from every cached viewport after the 204', async () => {
    const requests = stubApi(() => emptyResponse(204));
    const { queryClient, wrapper } = queryWrapper();
    queryClient.setQueryData<AreaList>(areasKey(ISRAEL, ZOOM), { areas: [orchard, vineyard] });
    queryClient.setQueryData<AreaList>(areasKey(HAIFA, ZOOM), { areas: [orchard] });
    const { result } = renderHook(() => useDeleteArea(), { wrapper });

    act(() => result.current.mutate(AREA_ID));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(requests[0]).toMatchObject({ method: 'DELETE', path: `/api/areas/${AREA_ID}` });
    expect(queryClient.getQueryData(areasKey(ISRAEL, ZOOM))).toEqual({ areas: [vineyard] });
    expect(queryClient.getQueryData(areasKey(HAIFA, ZOOM))).toEqual({ areas: [] });
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
  queryClient.setQueryData<AreaList>(areasKey(ISRAEL, ZOOM), { areas: [orchard, vineyard] });
  queryClient.setQueryData<AreaList>(areasKey(HAIFA, ZOOM), { areas: [vineyard] });
  const theirs = makeArea(AREA_ID, { name: 'Theirs', version: 3 });

  replaceArea(queryClient, theirs);

  expect(queryClient.getQueryData(areasKey(ISRAEL, ZOOM))).toEqual({ areas: [theirs, vineyard] });
  expect(queryClient.getQueryData(areasKey(HAIFA, ZOOM))).toEqual({ areas: [vineyard] });
});

describe('useAreaVersions', () => {
  const versions = [makeVersion(AREA_ID, 3), makeVersion(AREA_ID, 2), makeVersion(AREA_ID, 1)];

  it("fetches the area's versions, and again when the area's version moves", async () => {
    const requests = stubApi(() => jsonResponse(200, { versions }));
    const { wrapper } = queryWrapper();
    const { result, rerender } = renderHook(({ version }) => useAreaVersions(AREA_ID, version), {
      wrapper,
      initialProps: { version: 3 },
    });

    await waitFor(() => expect(result.current.data).toEqual({ versions }));
    expect(requests).toEqual([
      expect.objectContaining({ method: 'GET', path: `/api/areas/${AREA_ID}/versions` }),
    ]);

    rerender({ version: 4 });
    await waitFor(() => expect(requests).toHaveLength(2));
    // The last list stays on screen while the new one loads.
    expect(result.current.data).toEqual({ versions });
  });

  it('rejects a body that does not match the shared schema', async () => {
    stubApi(() => jsonResponse(200, { versions: [{ ...versions[0], version: 0 }] }));
    const { wrapper } = queryWrapper();
    const { result } = renderHook(() => useAreaVersions(AREA_ID, 3), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe('useRevertArea', () => {
  const reverted = makeArea(AREA_ID, { name: 'Orchard v1', version: 4 });

  function renderRevert(answer: () => Response, cachedArea = makeArea(AREA_ID, { version: 3 })) {
    const requests = stubApi(answer);
    const { queryClient, wrapper } = queryWrapper();
    queryClient.setQueryData<AreaList>(areasKey(ISRAEL, ZOOM), { areas: [cachedArea, vineyard] });
    queryClient.setQueryData<AreaList>(areasKey(HAIFA, ZOOM), { areas: [vineyard] });
    const view = renderHook(() => useRevertArea(), { wrapper });
    return { ...view, requests, queryClient };
  }

  it('posts the version and patches the 201 area into every viewport that has it', async () => {
    const { result, requests, queryClient } = renderRevert(() => jsonResponse(201, reverted));

    act(() => result.current.mutate({ id: AREA_ID, version: 1 }));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(requests).toEqual([
      expect.objectContaining({ method: 'POST', path: `/api/areas/${AREA_ID}/revert/1` }),
    ]);
    expect(queryClient.getQueryData(areasKey(ISRAEL, ZOOM))).toEqual({
      areas: [reverted, vineyard],
    });
    expect(queryClient.getQueryData(areasKey(HAIFA, ZOOM))).toEqual({ areas: [vineyard] });
  });

  it("keeps the cached copy when the WebSocket's area:updated already brought this or a newer version", async () => {
    const newer = makeArea(AREA_ID, { name: 'Renamed since', version: 5 });
    const { result, queryClient } = renderRevert(() => jsonResponse(201, reverted), newer);
    const before = queryClient.getQueryData(areasKey(ISRAEL, ZOOM));

    act(() => result.current.mutate({ id: AREA_ID, version: 1 }));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(queryClient.getQueryData(areasKey(ISRAEL, ZOOM))).toBe(before);
  });

  it('rejects a 409 (the area is deleted) with its code and leaves the cache alone', async () => {
    const { result, queryClient } = renderRevert(() =>
      jsonResponse(409, {
        code: ERROR_CODES.CONFLICT,
        message: 'Conflict',
        details: { reason: ERROR_REASONS.AREA_DELETED },
      }),
    );
    const before = queryClient.getQueryData(areasKey(ISRAEL, ZOOM));

    act(() => result.current.mutate({ id: AREA_ID, version: 1 }));

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toMatchObject({ status: 409, code: ERROR_CODES.CONFLICT });
    expect(queryClient.getQueryData(areasKey(ISRAEL, ZOOM))).toBe(before);
  });

  it("refreshes the area lists and the area's history on a 404", async () => {
    const { result, queryClient } = renderRevert(() =>
      jsonResponse(404, { code: ERROR_CODES.NOT_FOUND, message: 'Not found' }),
    );
    queryClient.setQueryData(versionsKey(AREA_ID, 3), { versions: [] });
    queryClient.setQueryData(versionsKey(OTHER_ID, 1), { versions: [] });

    act(() => result.current.mutate({ id: AREA_ID, version: 1 }));

    await waitFor(() => expect(result.current.isError).toBe(true));
    const stale = (key: readonly unknown[]) => queryClient.getQueryState(key)?.isInvalidated;
    expect(stale(areasKey(ISRAEL, ZOOM))).toBe(true);
    expect(stale(areasKey(HAIFA, ZOOM))).toBe(true);
    expect(stale(versionsKey(AREA_ID, 3))).toBe(true);
    expect(stale(versionsKey(OTHER_ID, 1))).toBe(false);
  });
});
