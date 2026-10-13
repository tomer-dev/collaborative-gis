import {
  type Bbox,
  AreaListSchema,
  QUERY,
  VersionsResponseSchema,
  type Area,
  type AreaList,
} from '@cgis/shared';
import { keepPreviousData, skipToken, useQuery, type QueryClient } from '@tanstack/react-query';
import { api, readBody } from './api-client';

// The area reads (viewport lists, version history) and the areas-cache updaters the mutations
// and the conflict dialog use. The mutations are in ./areas-mutations.ts.

/**
 * `[QUERY.AREAS_KEY, bbox, zoom]`: one viewport's areas, keyed by the raw debounced bbox and the
 * map's integer zoom (the server owns any quantisation, spec §5, and keys its bounds cache by
 * tile and zoom). The cached value is the `GET` body as parsed, `{ areas }`; the WebSocket hook
 * (T14) patches the same key and shape.
 */
export function areasKey(bbox: Bbox | null, zoom: number | null) {
  return [QUERY.AREAS_KEY, bbox, zoom] as const;
}

/** Matches every viewport's list. */
export const ALL_AREAS = { queryKey: [QUERY.AREAS_KEY] };

/** A cache updater: `change` applied to a cached `{ areas }`; a viewport not in the cache stays out. */
export const changeAreas =
  (change: (areas: Area[]) => Area[]) =>
  (list: AreaList | undefined): AreaList | undefined =>
    list && { areas: change(list.areas) };

/**
 * A bbox the API accepts: west < east and south < north. A zero-size map container reports
 * w === e (MapView's first, undebounced call can), which `BoundsQuerySchema` rejects.
 */
export function isQueryableBbox(bbox: Bbox | null): bbox is Bbox {
  return bbox !== null && bbox[0] < bbox[2] && bbox[1] < bbox[3];
}

async function fetchAreas(bbox: Bbox, zoom: number | null, signal: AbortSignal): Promise<AreaList> {
  const query = { bbox: bbox.join(','), ...(zoom === null ? {} : { zoom: String(zoom) }) };
  const res = await api.api.areas.$get({ query }, { init: { signal } });
  return readBody(res, 200, AreaListSchema);
}

/**
 * The saved areas in `bbox` (the map's debounced viewport) as `{ areas }`, parsed with the shared
 * schema in the query function, so every reader and patcher of the cache sees checked data; `zoom`
 * (the map's integer zoom) goes along as `?zoom=`. Off for a null or degenerate bbox. While a new
 * viewport loads, the last one's areas stay on screen.
 */
export function useAreasInBounds(bbox: Bbox | null, zoom: number | null) {
  return useQuery({
    queryKey: areasKey(bbox, zoom),
    queryFn: isQueryableBbox(bbox) ? ({ signal }) => fetchAreas(bbox, zoom, signal) : skipToken,
    placeholderData: keepPreviousData,
  });
}

/**
 * Every cached viewport that holds an older copy of `area.id` gets `area` in its place (an update,
 * a revert, "Load theirs"); a copy already at `area.version` or newer (the WebSocket's
 * `area:updated` for the same write, or a later one) stays.
 */
export function replaceArea(queryClient: QueryClient, area: Area): void {
  const newer = (cached: Area) => cached.id === area.id && cached.version < area.version;
  queryClient.setQueriesData<AreaList>(
    ALL_AREAS,
    changeAreas((areas) => areas.map((cached) => (newer(cached) ? area : cached))),
  );
}

/** Drops the area with `id` from every cached viewport (a delete). */
export function removeArea(queryClient: QueryClient, id: string): void {
  queryClient.setQueriesData<AreaList>(
    ALL_AREAS,
    changeAreas((areas) => areas.filter((cached) => cached.id !== id)),
  );
}

/** `[QUERY.VERSIONS_KEY, id, version]`: the history of area `id` while it is at `version`. */
export function versionsKey(id: string, version: number) {
  return [QUERY.VERSIONS_KEY, id, version] as const;
}

/**
 * The saved versions of area `id`, newest first, as `{ versions }` (`GET /api/areas/:id/versions`).
 * `version` is the area's current version, from the areas cache: a rename, a revert or another
 * user's edit moves it and the history refetches, the last list staying on screen meanwhile.
 */
export function useAreaVersions(id: string, version: number) {
  return useQuery({
    queryKey: versionsKey(id, version),
    queryFn: async ({ signal }) =>
      readBody(
        await api.api.areas[':id'].versions.$get({ param: { id } }, { init: { signal } }),
        200,
        VersionsResponseSchema,
      ),
    placeholderData: keepPreviousData,
  });
}
