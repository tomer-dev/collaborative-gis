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

// The viewport cache (D6, spec §5, ADR-0004). A bounds read is keyed by its quantised tile, its
// zoom and the map version the Room DO bumps on every area change, so a write moves every later
// read to a new key in every data center without a purge, and old entries expire by TTL. The
// Cache API is per data center; the version read is one Room RPC per request, hit or miss.

/** A viewport snapped to the `CACHE.TILE_QUANT_DEG` grid: the cache key part and the envelope. */
export type Tile = { key: string; bbox: Bbox };

/**
 * Snaps `[west, south, east, north]` outward to the `CACHE.TILE_QUANT_DEG` grid, clamped to the
 * WGS 84 range. `key` is the grid indices, so every viewport inside the same cells shares one
 * entry; the bounds query reads `bbox`, so that entry holds every area of the tile, not just the
 * first viewport's.
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

/** The synthetic Cache API key: `${ROUTES.AREAS}?tile=…&z=…&v=…` on the request's origin. */
export function boundsKey(origin: string, tile: Tile, zoom: number | undefined, version: number) {
  return new URL(
    `${ROUTES.AREAS}?tile=${tile.key}&z=${zoom ?? ''}&v=${version}`,
    origin,
  ).toString();
}

/**
 * The cache in front of the `GET /api/areas` handler, after query validation. The handler must
 * query `tileOf(bbox).bbox`, the envelope the entry is stored for.
 *
 * 1. The map version from the default Room (`getVersion()`, `TIMEOUTS.DO_PING_MS` deadline). If it
 *    fails or is late, the read goes to the database and nothing is stored (`BYPASS`), so bounds
 *    reads never fail with the Room.
 * 2. `If-None-Match` naming the ETag (a hash of version and tile) → 304, without a lookup.
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
    const { bbox, zoom } = c.req.valid('query');
    const tile = tileOf(bbox);

    let version: number;
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

    const etag = await etagOf(version, tile);
    const headers = {
      'cache-control': CACHE.CLIENT_CACHE_CONTROL,
      etag,
      [CACHE.STATUS_HEADER]: CACHE.STATUS.HIT,
    };
    if (matchesAny(c.req.header('if-none-match'), etag)) {
      logRead(c, CACHE.STATUS.HIT, tile, { version, notModified: true });
      return c.body(null, 304, headers);
    }

    const key = boundsKey(c.req.url, tile, zoom, version);
    const stored = await workersCache().match(key);
    if (stored) {
      logRead(c, CACHE.STATUS.HIT, tile, { version });
      const res = new Response(stored.body, stored);
      for (const [name, value] of Object.entries(headers)) res.headers.set(name, value);
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
    logRead(c, CACHE.STATUS.MISS, tile, { version });
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
function mapVersion(env: Env): Promise<number> {
  const room = env.ROOM.get(env.ROOM.idFromName(ROOM.DEFAULT_ROOM_ID));
  return withDeadline(room.getVersion(), TIMEOUTS.DO_PING_MS, 'room version');
}

/**
 * A strong ETag: SHA-256 of the map version and the tile, known before any lookup or query. One
 * version and tile hold one set of rows, except while a committed write waits for its fan-out to
 * bump the version (`waitUntil`, after the response): a read in that gap can see the new rows
 * under the old version, and the bump retires that key.
 */
async function etagOf(version: number, tile: Tile): Promise<string> {
  const data = new TextEncoder().encode(`${version}:${tile.key}`);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return `"${Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')}"`;
}

/** `If-None-Match` names `etag` (weak comparison, RFC 9110 §13.1.2), or is `*`. */
function matchesAny(ifNoneMatch: string | undefined, etag: string): boolean {
  if (!ifNoneMatch) return false;
  return ifNoneMatch.split(',').some((tag) => {
    const value = tag.trim();
    return value === '*' || value.replace(/^W\//, '') === etag;
  });
}

/** The read's one log line: the request fields, the cache outcome and the tile. */
function logRead(c: Context<AppEnv>, cache: CacheStatus, tile: Tile, fields: object): void {
  log('info', 'bounds read', { ...requestFields(c), cache, tile: tile.key, ...fields });
}
