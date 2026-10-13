import { CACHE, TIMEOUTS, type Area, type Bbox } from '@cgis/shared';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { env as workerEnv } from 'cloudflare:workers';
import { Hono } from 'hono';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { type AppEnv, createApp, type Env } from '../../src/app';
import { boundsKey, tileOf, workersCache } from '../../src/cache/bounds';
import * as db from '../../src/db';
import { areasClient, areasEnv, freshUser, squareAt } from '../areas/fixtures';
import { signUp, tokenCookie } from '../auth/session';
import { appWithUser } from '../helpers';

// D6: `GET /api/areas` is answered from the Workers Cache API under a key made of the quantised
// tile and the Room's map version. Wire values (headers, statuses) are spelled out: they
// are what browsers and the logs see.

let base: Env;
beforeAll(async () => {
  base = await areasEnv();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const STEP = CACHE.TILE_QUANT_DEG;

/**
 * `base` with every Room name resolved to one fresh Room: the reads' `getVersion()` and the
 * writes' `fanout` meet there, and no other test file's write moves this test's map version.
 */
function ownRoom() {
  const id = workerEnv.ROOM.idFromName(crypto.randomUUID());
  const room = workerEnv.ROOM.get(id);
  return { env: { ...base, ROOM: { idFromName: () => id, get: () => room } }, room };
}

/** `base` with a stand-in Room whose `getVersion` is `getVersion`. */
const withVersion = (getVersion: () => Promise<number>) => ({
  ...base,
  ROOM: { idFromName: () => ({}), get: () => ({ getVersion }) },
});

/**
 * A random tile-grid cell `[i, j]` (lower-left corner at `i * STEP, j * STEP`), away from the poles
 * and the antimeridian, so no other test or earlier run shares its tile.
 */
function randomCell(): [number, number] {
  const cells = (deg: number) => Math.floor((Math.random() * 2 - 1) * (deg / STEP));
  return [cells(150), cells(60)];
}

/** A viewport inside cell `[i, j]`, from fraction `from` to `to` of the cell on both axes. */
const inCell = ([i, j]: [number, number], from = 0.2, to = 0.6): Bbox => [
  (i + from) * STEP,
  (j + from) * STEP,
  (i + to) * STEP,
  (j + to) * STEP,
];

const query = (bbox: Bbox, zoom?: number) =>
  `bbox=${bbox.join(',')}${zoom === undefined ? '' : `&zoom=${zoom}`}`;

const idsOf = async (res: Response) =>
  (await res.clone().json<{ areas: Area[] }>()).areas.map((area) => area.id);

/** Creates a 0.01° square with its south-west corner at `[lng, lat]` and returns its id. */
async function createAt(api: ReturnType<typeof areasClient>, lng: number, lat: number) {
  const res = await api.create({ name: 'cached', geometry: squareAt([lng, lat]) });
  expect(res.status).toBe(201);
  return (await res.json<Area>()).id;
}

describe('tileOf: the server-side quantisation (spec §5)', () => {
  it('snaps a viewport outward to the CACHE.TILE_QUANT_DEG grid; the key is the grid indices', () => {
    const tile = tileOf([34.83, 31.27, 35.11, 31.52]);
    expect(STEP).toBe(0.1);
    expect(tile.key).toBe('348,312,352,316');
    const [w, s, e, n] = tile.bbox;
    expect([w, s, e, n].map((x) => Number(x.toFixed(9)))).toEqual([34.8, 31.2, 35.2, 31.6]);
  });

  it('two viewports in the same cells share a tile; a viewport crossing a grid line does not', () => {
    const cell = randomCell();
    expect(tileOf(inCell(cell, 0.1, 0.4)).key).toBe(tileOf(inCell(cell, 0.5, 0.9)).key);
    expect(tileOf(inCell(cell, 0.5, 1.2)).key).not.toBe(tileOf(inCell(cell)).key);
  });

  it('never leaves the WGS 84 range', () => {
    expect(tileOf([-179.95, -89.95, 179.95, 89.95]).bbox).toEqual([-180, -90, 180, 90]);
  });
});

describe('GET /api/areas through the bounds cache', () => {
  it('a second identical read is a HIT: same body and ETag, no database call', async () => {
    const { env } = ownRoom();
    const api = areasClient(env, freshUser());
    const cell = randomCell();
    const id = await createAt(api, (cell[0] + 0.3) * STEP, (cell[1] + 0.3) * STEP);
    const withClient = vi.spyOn(db, 'withClient');

    const first = await api.list(query(inCell(cell), 12));
    expect(first.status).toBe(200);
    expect(first.headers.get('x-cache')).toBe('MISS');
    expect(first.headers.get('etag')).toMatch(/^"[0-9a-f]{64}"$/);
    expect(await idsOf(first)).toEqual([id]);
    expect(withClient).toHaveBeenCalledOnce();

    const second = await api.list(query(inCell(cell), 12));
    expect(second.status).toBe(200);
    expect(second.headers.get('x-cache')).toBe('HIT');
    expect(second.headers.get('etag')).toBe(first.headers.get('etag'));
    expect(await second.text()).toBe(await first.text());
    expect(withClient).toHaveBeenCalledOnce();
  });

  it('viewports that snap to one tile share its entry, which holds every area in the tile', async () => {
    const { env } = ownRoom();
    const api = areasClient(env, freshUser());
    const cell = randomCell();
    // Inside the tile, outside the first viewport (0.2–0.6 of the cell).
    const id = await createAt(api, (cell[0] + 0.7) * STEP, (cell[1] + 0.7) * STEP);

    const first = await api.list(query(inCell(cell, 0.2, 0.6)));
    const second = await api.list(query(inCell(cell, 0.3, 0.8)));

    expect(first.headers.get('x-cache')).toBe('MISS');
    expect(await idsOf(first)).toEqual([id]);
    expect(second.headers.get('x-cache')).toBe('HIT');
    expect(await second.text()).toBe(await first.text());
  });

  it('after bumpVersion() the next read misses and gets a new ETag', async () => {
    const { env, room } = ownRoom();
    const api = areasClient(env, freshUser());
    const cell = randomCell();

    const first = await api.list(query(inCell(cell)));
    expect((await api.list(query(inCell(cell)))).headers.get('x-cache')).toBe('HIT');
    await room.bumpVersion();
    const withClient = vi.spyOn(db, 'withClient');
    const after = await api.list(query(inCell(cell)));

    expect(after.status).toBe(200);
    expect(after.headers.get('x-cache')).toBe('MISS');
    expect(after.headers.get('etag')).not.toBe(first.headers.get('etag'));
    expect(withClient).toHaveBeenCalledOnce();
  });

  it('a write is in the next read of its tile, although an entry for the old version existed', async () => {
    const { env } = ownRoom();
    const api = areasClient(env, freshUser());
    const cell = randomCell();
    const before = await api.list(query(inCell(cell)));
    expect(await idsOf(before)).toEqual([]);

    // The create's fan-out bumps the map version (Room.broadcast), as every area:* event does.
    const id = await createAt(api, (cell[0] + 0.3) * STEP, (cell[1] + 0.3) * STEP);
    const after = await api.list(query(inCell(cell)));

    expect(after.headers.get('x-cache')).toBe('MISS');
    expect(await idsOf(after)).toEqual([id]);
  });

  it('a read right after a write misses the old key, even while the fan-out has not run', async () => {
    // The real Room's counter, but a broadcast that never settles: only the write's own bump,
    // awaited before its response, can move the version the next read keys on.
    const { room } = ownRoom();
    const env = {
      ...base,
      ROOM: {
        idFromName: () => ({}),
        get: () => ({
          getVersion: () => room.getVersion(),
          bumpVersion: () => room.bumpVersion(),
          broadcast: () => new Promise<void>(() => {}),
        }),
      },
    };
    const api = areasClient(env, freshUser(), {}, createExecutionContext());
    const cell = randomCell();
    expect((await api.list(query(inCell(cell), 12))).headers.get('x-cache')).toBe('MISS');
    expect((await api.list(query(inCell(cell), 12))).headers.get('x-cache')).toBe('HIT');

    const id = await createAt(api, (cell[0] + 0.3) * STEP, (cell[1] + 0.3) * STEP);
    const after = await api.list(query(inCell(cell), 12));

    expect(after.headers.get('x-cache')).toBe('MISS');
    expect(await idsOf(after)).toEqual([id]);
    expect(await room.getVersion()).toBe(1);
  });

  it('the zoom is not part of the key: the response does not vary by zoom, so zooms share a tile', async () => {
    const { env } = ownRoom();
    const api = areasClient(env, freshUser());
    const cell = randomCell();

    expect((await api.list(query(inCell(cell), 10))).headers.get('x-cache')).toBe('MISS');
    expect((await api.list(query(inCell(cell), 11))).headers.get('x-cache')).toBe('HIT');
    expect((await api.list(query(inCell(cell)))).headers.get('x-cache')).toBe('HIT');
  });
});

describe('ETag and If-None-Match', () => {
  it('the current ETag → 304 with no body and no database call; after a bump → 200', async () => {
    const { env, room } = ownRoom();
    const user = freshUser();
    const cell = randomCell();
    const first = await areasClient(env, user).list(query(inCell(cell)));
    const etag = first.headers.get('etag') ?? '';
    const withClient = vi.spyOn(db, 'withClient');

    // Weak comparison (RFC 9110 §13.1.2): a W/ prefix or a list naming the tag also matches.
    for (const ifNoneMatch of [etag, `W/${etag}`, `"other", ${etag}`, '*']) {
      const res = await areasClient(env, user, { 'if-none-match': ifNoneMatch }).list(
        query(inCell(cell)),
      );
      expect(res.status, ifNoneMatch).toBe(304);
      expect(await res.text()).toBe('');
      expect(res.headers.get('etag')).toBe(etag);
      expect(res.headers.get('cache-control')).toBe('private, no-cache');
    }
    expect(withClient).not.toHaveBeenCalled();

    await room.bumpVersion();
    const stale = await areasClient(env, user, { 'if-none-match': etag }).list(query(inCell(cell)));
    expect(stale.status).toBe(200);
    expect(stale.headers.get('etag')).not.toBe(etag);
  });

  it('a non-matching If-None-Match is an ordinary read', async () => {
    const { env } = ownRoom();
    const res = await areasClient(env, freshUser(), { 'if-none-match': '"nope"' }).list(
      query(inCell(randomCell())),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('x-cache')).toBe('MISS');
  });
});

describe('the Room does not answer', () => {
  it(`a getVersion() past TIMEOUTS.DO_PING_MS (${TIMEOUTS.DO_PING_MS} ms) skips the cache: 200 from the database (BYPASS)`, async () => {
    const cell = randomCell();
    const id = await createAt(
      areasClient(ownRoom().env, freshUser()),
      cell[0] * STEP,
      cell[1] * STEP,
    );
    const api = areasClient(
      withVersion(() => new Promise<number>(() => {})),
      freshUser(),
    );
    const withClient = vi.spyOn(db, 'withClient');

    const started = Date.now();
    const res = await api.list(query(inCell(cell, 0, 0.5)));
    const elapsed = Date.now() - started;

    expect(res.status).toBe(200);
    expect(res.headers.get('x-cache')).toBe('BYPASS');
    expect(res.headers.get('etag')).toBeNull();
    expect(res.headers.get('cache-control')).toBe('private, no-cache');
    expect(await idsOf(res)).toEqual([id]);
    expect(withClient).toHaveBeenCalledOnce();
    expect(elapsed).toBeGreaterThanOrEqual(TIMEOUTS.DO_PING_MS);
    expect(elapsed).toBeLessThan(TIMEOUTS.REQUEST_MS);
  });

  it('a getVersion() that rejects skips the cache at once', async () => {
    const api = areasClient(
      withVersion(async () => {
        throw new Error('room unavailable');
      }),
      freshUser(),
    );
    const started = Date.now();
    const res = await api.list(query(inCell(randomCell())));
    expect(res.status).toBe(200);
    expect(res.headers.get('x-cache')).toBe('BYPASS');
    expect(Date.now() - started).toBeLessThan(TIMEOUTS.DO_PING_MS);
  });
});

describe('nothing about the reader is cached', () => {
  it('two readers get the same bytes, which name neither of them', async () => {
    const { env } = ownRoom();
    const cell = randomCell();
    await createAt(areasClient(env, freshUser('owner')), cell[0] * STEP, cell[1] * STEP);
    const [ada, bob] = [freshUser('reader'), freshUser('reader')];

    const first = await areasClient(env, ada).list(query(inCell(cell)));
    const second = await areasClient(env, bob).list(query(inCell(cell)));

    expect(first.headers.get('x-cache')).toBe('MISS');
    expect(second.headers.get('x-cache')).toBe('HIT');
    const body = await first.text();
    expect(await second.text()).toBe(body);
    for (const reader of [ada, bob]) expect(body).not.toContain(reader.id);
  });

  it('a session cookie refreshed on a MISS goes out on that response only; the entry holds no per-request header', async () => {
    const { env, room } = ownRoom();
    const { cookie } = await signUp(base);
    const cell = randomCell();
    const ctx = createExecutionContext();
    // The token alone: Better Auth re-reads the session and sets a fresh cookie-cache cookie.
    const res = await createApp().request(
      `http://x/api/areas?${query(inCell(cell), 9)}`,
      { headers: { cookie: tokenCookie(cookie), origin: env.CLIENT_ORIGIN } },
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-cache')).toBe('MISS');
    expect(res.headers.getSetCookie()).not.toEqual([]);
    expect(res.headers.get('x-request-id')).not.toBeNull();

    const key = boundsKey('http://x', tileOf(inCell(cell)), await room.getVersion());
    const entry = await workersCache().match(key);
    expect(entry?.status).toBe(200);
    for (const name of entry!.headers.keys()) {
      expect(name).not.toMatch(/set-cookie|x-request-id|access-control|x-cache|vary/);
    }
    expect(entry?.headers.get('cache-control')).toBe(`s-maxage=${CACHE.BOUNDS_TTL_S}`);
    expect(entry?.headers.get('etag')).toBe(res.headers.get('etag'));
    expect(await entry?.text()).toBe(await res.text());
  });

  it('a HIT keeps the headers the chain set for this request: the refreshed session cookie, CORS, request id', async () => {
    const { env } = ownRoom();
    const { cookie } = await signUp(base);
    const cell = randomCell();
    const read = async () => {
      const ctx = createExecutionContext();
      // The token alone: attachUser's session read refreshes the cookie-cache cookie each time.
      const res = await createApp().request(
        `http://x/api/areas?${query(inCell(cell))}`,
        { headers: { cookie: tokenCookie(cookie), origin: env.CLIENT_ORIGIN } },
        env,
        ctx,
      );
      await waitOnExecutionContext(ctx);
      return res;
    };
    expect((await read()).headers.get('x-cache')).toBe('MISS');

    const hit = await read();

    expect(hit.headers.get('x-cache')).toBe('HIT');
    expect(hit.headers.getSetCookie()).not.toEqual([]);
    expect(hit.headers.get('access-control-allow-origin')).toBe(env.CLIENT_ORIGIN);
    expect(hit.headers.get('x-request-id')).not.toBeNull();
  });

  it('a HIT keeps a header an earlier middleware put on the response before the cache ran', async () => {
    const { env } = ownRoom();
    const user = freshUser();
    const cell = randomCell();
    const app = new Hono<AppEnv>()
      .use('*', async (c, next) => {
        c.res.headers.set('x-chain', 'kept');
        await next();
      })
      .route('/', appWithUser(user));
    const read = async () => {
      const ctx = createExecutionContext();
      const res = await app.request(`/api/areas?${query(inCell(cell))}`, {}, env, ctx);
      await waitOnExecutionContext(ctx);
      return res;
    };
    expect((await read()).headers.get('x-cache')).toBe('MISS');

    const hit = await read();

    expect(hit.headers.get('x-cache')).toBe('HIT');
    expect(hit.headers.get('x-chain')).toBe('kept');
  });
});

describe('the request log line', () => {
  it('carries the cache outcome: MISS, then HIT', async () => {
    const { env } = ownRoom();
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const api = areasClient(env, freshUser());
    const cell = randomCell();

    await api.list(query(inCell(cell)));
    await api.list(query(inCell(cell)));

    const lines = info.mock.calls.map(([line]) => JSON.parse(String(line)));
    expect(lines).toEqual([
      expect.objectContaining({ level: 'info', path: '/api/areas', cache: 'MISS' }),
      expect.objectContaining({ level: 'info', path: '/api/areas', cache: 'HIT' }),
    ]);
    expect(lines[0]).toMatchObject({
      tile: tileOf(inCell(cell)).key,
      requestId: expect.any(String),
    });
  });
});
