import {
  CACHE,
  ROOM,
  ROUTES,
  TIMEOUTS,
  type Bbox,
  type BoundsQuery,
  type CacheStatus,
} from '@cgis/shared';
import type { Context, MiddlewareHandler } from 'hono';
import type { AppEnv, Env } from '../app';
import { withDeadline } from '../db';
import { log, requestFields } from '../log';

// The viewport cache (D6, spec §5, ADR-0004). A bounds read is keyed by its quantised tile and the
// map version the Room DO bumps on every area change, so a write moves every later read to a new
// key in every data center without a purge, and old entries expire by TTL. The query's `zoom` is
// accepted but not in the key: the response does not vary by zoom (nothing is simplified by zoom
// yet), so keying on it would only split one tile's entry per zoom level. The Cache API is per
// data center; the version read is one Room RPC per request, hit or miss.

/** A viewport snapped to the `CACHE.TILE_QUANT_DEG` grid: the cache key part and the envelope. */
export type Tile = { key: string; bbox: Bbox };

/**
 * `Room.getVersion()`: the version counter and the storage epoch it counts in. A Room that lost
 * its storage counts from 0 again under a new epoch, so keys stamped `epoch.version` never repeat
 * and no entry from before the loss is served.
 */
export type MapVersion = { epoch: string; version: number };

const stamp = ({ epoch, version }: MapVersion) => `${epoch}.${version}`;

/**
 * Snaps `[west, south, east, north]` outward to the `CACHE.TILE_QUANT_DEG` grid, clamped to the
 * WGS 84 range. Why: without snapping, every pan produces a new bbox and so a new key, and the
 * cache would never hit. Snapped, every viewport inside the same cells shares one entry (D6,
 * spec §5: the bbox is quantised to a tile grid). `key` is the grid indices; the bounds query
 * reads `bbox`, so that entry holds every area of the tile, not just the first viewport's.
 */
export function tileOf([west, south, east, north]: Bbox): Tile {
  const step = CACHE.TILE_QUANT_DEG;
  const [x0, y0, x1, y1] = [
    Math.floor(west / step),
    Math.floor(south / step),
    Math.ceil(east / step),
    Math.ceil(north / step),
  ];
  return {
    key: `${x0},${y0},${x1},${y1}`,
    bbox: [
      Math.max(x0 * step, -180),
      Math.max(y0 * step, -90),
      Math.min(x1 * step, 180),
      Math.min(y1 * step, 90),
    ],
  };
}

/**
 * The synthetic Cache API key on the request's origin:
 * `${ROUTES.AREAS}?tile=${tile}&v=${epoch}.${version}`.
 */
export function boundsKey(origin: string, tile: Tile, version: MapVersion): string {
  const query = `tile=${tile.key}&v=${stamp(version)}`;
  return new URL(`${ROUTES.AREAS}?${query}`, origin).toString();
}

/**
 * The cache in front of the `GET /api/areas` handler, after query validation. The handler must
 * query `tileOf(bbox).bbox`, the envelope the entry is stored for.
 *
 * 1. The map version from the default Room (`getVersion()`, `TIMEOUTS.DO_PING_MS` deadline). If it
 *    fails or is late, the read goes to the database and nothing is stored (`BYPASS`), so bounds
 *    reads never fail with the Room.
 * 2. `If-None-Match` naming the ETag (epoch, version and tile) → 304, without a lookup.
 * 3. A stored entry → that body (`HIT`).
 * 4. Else the handler queries; a 200 is stored with `Cache-Control: s-maxage=CACHE.BOUNDS_TTL_S`
 *    and the ETag, in `waitUntil` (`MISS`). The stored copy is rebuilt from the body with only
 *    those headers, so no cookie, request id or CORS header of this request is kept: the body is
 *    the same for every signed-in user (areas are shared, D12).
 *
 * The browser gets `CACHE.CLIENT_CACHE_CONTROL` and the ETag, and `CACHE.STATUS_HEADER` names the
 * outcome, which the read's log line also carries.
 */
export function boundsCache(): MiddlewareHandler<AppEnv, string, { out: { query: BoundsQuery } }> {
  return async (c, next) => {
    const { bbox } = c.req.valid('query');
    const tile = tileOf(bbox);

    let version: MapVersion;
    try {
      version = await mapVersion(c.env);
    } catch (err) {
      await next();
      c.res.headers.set('cache-control', CACHE.CLIENT_CACHE_CONTROL);
      c.res.headers.set(CACHE.STATUS_HEADER, CACHE.STATUS.BYPASS);
      logRead(c, CACHE.STATUS.BYPASS, tile, {
        room: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    const etag = etagOf(version, tile);
    const headers = {
      'cache-control': CACHE.CLIENT_CACHE_CONTROL,
      etag,
      [CACHE.STATUS_HEADER]: CACHE.STATUS.HIT,
    };
    // Weak comparison (RFC 9110 §13.1.2): a quoted tag never matches inside another, and `W/` passes.
    if (c.req.header('if-none-match')?.includes(etag)) {
      logRead(c, CACHE.STATUS.HIT, tile, { version: stamp(version), notModified: true });
      return c.body(null, 304, headers);
    }

    const key = boundsKey(c.req.url, tile, version);
    const stored = await workersCache().match(key);
    if (stored) {
      logRead(c, CACHE.STATUS.HIT, tile, { version: stamp(version) });
      const res = new Response(stored.body, stored);
      for (const [name, value] of Object.entries(headers)) res.headers.set(name, value);
      // This request's own headers still reach the client: Hono copies what earlier middleware
      // put on `c.res` (CORS, the request id) onto a returned Response, and attachUser appends a
      // refreshed session cookie after `next()`. The stored entry carries none of them.
      return res;
    }

    await next();
    if (c.res.status === 200) {
      const entry = new Response(c.res.clone().body, {
        headers: {
          'content-type': c.res.headers.get('content-type') ?? '',
          'cache-control': `s-maxage=${CACHE.BOUNDS_TTL_S}`,
          etag,
        },
      });
      c.executionCtx.waitUntil(workersCache().put(key, entry));
      c.res.headers.set('etag', etag);
    }
    c.res.headers.set('cache-control', CACHE.CLIENT_CACHE_CONTROL);
    c.res.headers.set(CACHE.STATUS_HEADER, CACHE.STATUS.MISS);
    logRead(c, CACHE.STATUS.MISS, tile, { version: stamp(version) });
  };
}

/**
 * `caches.default`, the Workers cache of this data center. The api's tsconfig also loads the DOM
 * lib, whose `CacheStorage` has no `default`, so the property is checked, not cast.
 */
export function workersCache(): Cache {
  const cache: unknown = Reflect.get(caches, 'default');
  if (cache instanceof Cache) return cache;
  throw new Error('caches.default is missing: not running on Workers');
}

/** The default Room's map version (D11: one map), or a rejection past `TIMEOUTS.DO_PING_MS`. */
function mapVersion(env: Env): Promise<MapVersion> {
  const room = env.ROOM.get(env.ROOM.idFromName(ROOM.DEFAULT_ROOM_ID));
  return withDeadline(room.getVersion(), TIMEOUTS.DO_PING_MS, 'room version');
}

/**
 * A strong ETag: the map version (epoch and counter) and the tile, known before any lookup or
 * query. One version and tile hold one set of rows: a write bumps the version after its commit
 * and before its response (`publish`), so only a read that overlaps the write itself, between the
 * commit and the bump, can see the new rows under the old version, and the bump retires that key
 * at once.
 */
const etagOf = (version: MapVersion, tile: Tile) => `"${stamp(version)}:${tile.key}"`;

/** The read's one log line: the request fields, the cache outcome and the tile. */
function logRead(c: Context<AppEnv>, cache: CacheStatus, tile: Tile, fields: object): void {
  log('info', 'bounds read', { ...requestFields(c), cache, tile: tile.key, ...fields });
}
