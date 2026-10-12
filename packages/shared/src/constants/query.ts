/**
 * TanStack Query keys the SPA's data layer (T13) and room hook (T14) share: the first element of
 * each key, so one prefix matches every variant.
 */
export const QUERY = {
  /** `[AREAS_KEY, bbox]`: the areas in one viewport (`GET /api/areas?bbox=`). */
  AREAS_KEY: 'areas',
  /** Retries of a failed query (TanStack Query's default); a 401 is never retried. */
  RETRY_LIMIT: 3,
} as const;
