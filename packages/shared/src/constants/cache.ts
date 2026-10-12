/**
 * The viewport cache (D6, spec §5): `GET /api/areas` answers from the Workers Cache API under a
 * key of the quantised tile, the zoom and the Room's map version.
 */
export const CACHE = {
  /**
   * Lifetime of a bounds entry in the Cache API (`Cache-Control: s-maxage` on the stored copy). A
   * write never waits for it: it bumps the map version, so later reads use a new key.
   */
  BOUNDS_TTL_S: 30,
  /**
   * Grid step (degrees, ~11 km of latitude) a viewport is snapped outward to before the query and
   * the cache key. It adds less than one step per side, so a zoomed-in viewport's query stays small
   * next to `LIMITS.BOUNDS_LIMIT`, while nearby viewports share one entry.
   */
  TILE_QUANT_DEG: 0.1,
  /**
   * `Cache-Control` the browser gets: kept, but revalidated each time by `If-None-Match` (a 304
   * while the map version is unchanged); `private`, so no shared cache serves it without a session.
   */
  CLIENT_CACHE_CONTROL: 'private, no-cache',
  /** Response header naming how the read was answered (one of `STATUS`); also a log field. */
  STATUS_HEADER: 'x-cache',
  /**
   * `HIT`: from the Cache API, or a 304 from the version alone. `MISS`: queried, then stored.
   * `BYPASS`: the Room did not give its version in time, so the read is queried and not stored.
   */
  STATUS: { HIT: 'HIT', MISS: 'MISS', BYPASS: 'BYPASS' },
} as const;

export type CacheStatus = (typeof CACHE.STATUS)[keyof typeof CACHE.STATUS];
