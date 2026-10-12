import {
  type Bbox,
  ApiErrorSchema,
  AreaListSchema,
  AreaSchema,
  COPY,
  ERROR_CODES,
  QUERY,
  VersionsResponseSchema,
  type Area,
  type AreaCreate,
  type AreaList,
  type AreaUpdate,
} from '@cgis/shared';
import {
  keepPreviousData,
  skipToken,
  useMutation,
  useMutationState,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { z } from 'zod';
import { api, ApiRequestError, expectStatus, readBody } from './api-client';
import { ringAreaKm2 } from './geo/geodesic';
import { useSession } from './session';

/**
 * `[QUERY.AREAS_KEY, bbox]`: one viewport's areas, keyed by the raw debounced bbox (the server owns
 * any quantisation, spec §5). The cached value is the `GET` body as parsed, `{ areas }`; the
 * WebSocket hook (T14) patches the same key and shape.
 */
export function areasKey(bbox: Bbox | null) {
  return [QUERY.AREAS_KEY, bbox] as const;
}

/** Matches every viewport's list. */
const ALL_AREAS = { queryKey: [QUERY.AREAS_KEY] };

/** A cache updater: `change` applied to a cached `{ areas }`; a viewport not in the cache stays out. */
const patchAreas =
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

async function fetchAreas(bbox: Bbox, signal: AbortSignal): Promise<AreaList> {
  const res = await api.api.areas.$get({ query: { bbox: bbox.join(',') } }, { init: { signal } });
  return readBody(res, 200, AreaListSchema);
}

/**
 * The saved areas in `bbox` (the map's debounced viewport) as `{ areas }`, parsed with the shared
 * schema in the query function, so every reader and patcher of the cache sees checked data. Off
 * for a null or degenerate bbox. While a new viewport loads, the last one's areas stay on screen.
 */
export function useAreasInBounds(bbox: Bbox | null) {
  return useQuery({
    queryKey: areasKey(bbox),
    queryFn: isQueryableBbox(bbox) ? ({ signal }) => fetchAreas(bbox, signal) : skipToken,
    placeholderData: keepPreviousData,
  });
}

/** Every cached viewport that holds `area.id` gets `area` in its place (an update, "Load theirs"). */
export function replaceArea(queryClient: QueryClient, area: Area): void {
  queryClient.setQueriesData<AreaList>(
    ALL_AREAS,
    patchAreas((areas) => areas.map((cached) => (cached.id === area.id ? area : cached))),
  );
}

/**
 * `replaceArea`, deduped by version: a viewport whose copy is already at `area.version` or newer
 * (the WebSocket's `area:updated` for the same write, or a later one) keeps it.
 */
function replaceOlderArea(queryClient: QueryClient, area: Area): void {
  queryClient.setQueriesData<AreaList>(ALL_AREAS, (list) =>
    list?.areas.some((cached) => cached.id === area.id && cached.version < area.version)
      ? { areas: list.areas.map((cached) => (cached.id === area.id ? area : cached)) }
      : list,
  );
}

/** Drops the area with `id` from every cached viewport (a delete). */
export function removeArea(queryClient: QueryClient, id: string): void {
  queryClient.setQueriesData<AreaList>(
    ALL_AREAS,
    patchAreas((areas) => areas.filter((cached) => cached.id !== id)),
  );
}

/** The area as the client would store it: a temporary id, version 1, the client's area estimate. */
function optimisticArea(input: AreaCreate, createdBy: string): Area {
  const now = new Date().toISOString();
  return {
    ...input,
    id: crypto.randomUUID(),
    areaKm2: ringAreaKm2(input.geometry.coordinates[0]),
    version: 1,
    createdBy,
    createdAt: now,
    updatedAt: now,
  };
}

/** Where the optimistic area went: its viewport's key and its temporary id. */
type OptimisticEntry = { key: ReturnType<typeof areasKey>; tempId: string };

const CREATE_AREA = [QUERY.CREATE_AREA_KEY];
const OptimisticContextSchema = z.object({ tempId: z.string() });

/**
 * The temporary ids of the optimistic areas whose create is still in flight: shown on the map,
 * but not selectable until the server's id replaces them (a rename or delete would 404).
 */
export function usePendingAreaIds(): ReadonlySet<string> {
  const ids = useMutationState({
    filters: { mutationKey: CREATE_AREA, status: 'pending' },
    select: (mutation) => OptimisticContextSchema.safeParse(mutation.state.context).data?.tempId,
  });
  return new Set(ids.filter((id) => id !== undefined));
}

/**
 * Creates an area (`POST /api/areas` → 201). Optimistic: the area joins the `bbox` viewport at once
 * under a temporary id and leaves it if the server refuses (a 422 carries `error.reason`); on
 * success the server's area takes its place. The area lists refetch afterwards either way.
 */
export function useCreateArea(bbox: Bbox | null) {
  const queryClient = useQueryClient();
  const userId = useSession().data?.id ?? '';
  return useMutation<Area, Error, AreaCreate, OptimisticEntry | undefined>({
    mutationKey: CREATE_AREA,
    mutationFn: async (input) =>
      readBody(await api.api.areas.$post({ json: input }), 201, AreaSchema),
    onMutate: async (input) => {
      if (!isQueryableBbox(bbox)) return undefined;
      const key = areasKey(bbox);
      // An in-flight fetch for this viewport would overwrite the optimistic entry.
      await queryClient.cancelQueries({ queryKey: key });
      const optimistic = optimisticArea(input, userId);
      queryClient.setQueryData<AreaList>(key, (list) => ({
        areas: [...(list?.areas ?? []), optimistic],
      }));
      return { key, tempId: optimistic.id };
    },
    // Rolls back by id rather than restoring a snapshot, so area patches that landed meanwhile stay.
    onError: (_error, _input, context) => {
      if (!context) return;
      queryClient.setQueryData<AreaList>(
        context.key,
        patchAreas((areas) => areas.filter((cached) => cached.id !== context.tempId)),
      );
    },
    // The WebSocket may have added the server's copy already; keep exactly one.
    onSuccess: (area, _input, context) => {
      if (!context) return;
      queryClient.setQueryData<AreaList>(
        context.key,
        patchAreas((areas) => [
          ...areas.filter((cached) => cached.id !== context.tempId && cached.id !== area.id),
          area,
        ]),
      );
    },
    onSettled: () => queryClient.invalidateQueries(ALL_AREAS),
  });
}

/** One area edit: the area's id and the `PUT` body, whose `version` is the one the edit started from. */
export type AreaEdit = { id: string; body: AreaUpdate };

const ConflictSchema = ApiErrorSchema.extend({ details: z.object({ current: AreaSchema }) });

/** A 409 from `PUT /api/areas/:id`: someone saved a newer version, which is `current`. */
export class AreaConflictError extends ApiRequestError {
  readonly current: Area;

  constructor(body: z.infer<typeof ConflictSchema>) {
    super(409, body);
    this.name = 'AreaConflictError';
    this.current = body.details.current;
  }
}

/**
 * Updates an area (`PUT /api/areas/:id` → 200) and puts the server's copy in every cached viewport.
 * A stale `version` rejects with `AreaConflictError` (`current` is the stored area); nothing
 * retries it, the caller asks the user (ConflictDialog).
 */
export function useUpdateArea() {
  const queryClient = useQueryClient();
  return useMutation<Area, Error, AreaEdit>({
    mutationFn: async ({ id, body }) => {
      const res = await api.api.areas[':id'].$put({ param: { id }, json: body });
      if (res.status === 409) throw new AreaConflictError(await readBody(res, 409, ConflictSchema));
      return readBody(res, 200, AreaSchema);
    },
    onSuccess: (area) => replaceArea(queryClient, area),
  });
}

/** Deletes an area (`DELETE /api/areas/:id` → 204) and drops it from every cached viewport. */
export function useDeleteArea() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: async (id) =>
      expectStatus(await api.api.areas[':id'].$delete({ param: { id } }), 204),
    onSuccess: (_result, id) => removeArea(queryClient, id),
  });
}

/**
 * `[QUERY.VERSIONS_KEY, id, version]`: the history of area `id` while it is at `version`. Without
 * `version` it matches the area's history at any version (invalidation).
 */
export function versionsKey(id: string, version?: number) {
  return version === undefined
    ? ([QUERY.VERSIONS_KEY, id] as const)
    : ([QUERY.VERSIONS_KEY, id, version] as const);
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

/** One revert: the area's id and the saved version to bring back. */
export type AreaRevert = { id: string; version: number };

/**
 * Reverts an area to a saved version (`POST /api/areas/:id/revert/:version` → 201, the area at its
 * new version) and patches it into the cached viewports, unless the WebSocket's `area:updated`
 * got there first. A 409 means the area is deleted (`details.reason`); a 404 means the area or the
 * version is gone, so the area lists and that area's history refetch.
 */
export function useRevertArea() {
  const queryClient = useQueryClient();
  return useMutation<Area, Error, AreaRevert>({
    mutationFn: async ({ id, version }) =>
      readBody(
        await api.api.areas[':id'].revert[':version'].$post({
          param: { id, version: String(version) },
        }),
        201,
        AreaSchema,
      ),
    onSuccess: (area) => replaceOlderArea(queryClient, area),
    onError: (error, { id }) => {
      if (!(error instanceof ApiRequestError) || error.code !== ERROR_CODES.NOT_FOUND) return;
      void queryClient.invalidateQueries(ALL_AREAS);
      void queryClient.invalidateQueries({ queryKey: versionsKey(id) });
    },
  });
}

/**
 * The `name` entry of a submitted area form, trimmed, or null when it does not pass
 * `AreaSchema.name` (only spaces: `required` lets it through; `maxLength` blocks the long ones).
 */
export function formAreaName(form: FormData): string | null {
  const name = AreaSchema.shape.name.safeParse(form.get('name'));
  return name.success ? name.data : null;
}

/** Text for a failed area call: PostGIS's `reason` (422), else the server's message, else generic. */
export function areaErrorMessage(error: unknown): string {
  if (!(error instanceof ApiRequestError)) return COPY.AREAS.ERROR_GENERIC;
  return error.reason ?? error.message;
}
