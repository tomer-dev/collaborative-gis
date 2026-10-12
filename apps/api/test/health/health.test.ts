import { ROOM, TIMEOUTS } from '@cgis/shared';
import { SELF } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app';

// Wire values (bodies, states, log fields) are spelled out: they are what probes and dashboards read.

/** Sends `GET /readyz` to a fresh app with `bindings`, timing the answer. */
async function readyz(bindings: object) {
  const started = Date.now();
  const res = await createApp().request('http://x/readyz', {}, bindings);
  return { res, elapsed: Date.now() - started };
}

/**
 * `env` with a stand-in `ROOM` for the two namespace calls the Room ping makes: `idFromName`,
 * then `get(...).getVersion()`, here `getVersion`. Test-only: production code has no switch to
 * make the Room fail.
 */
function withRoom(getVersion: () => Promise<number>, names: string[] = []) {
  return {
    ...env,
    ROOM: {
      idFromName: (name: string) => {
        names.push(name);
        return {};
      },
      get: () => ({ getVersion }),
    },
  };
}

/** `env` whose database is `connectionString`; the Room stays the real one. */
const withDatabase = (connectionString: string) => ({ ...env, HYPERDRIVE: { connectionString } });

/** The one structured line a failed readiness check logs. */
const loggedLine = (log: { mock: { calls: unknown[][] } }) =>
  JSON.parse(String(log.mock.calls[0]?.[0]));

describe('health', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('GET /healthz returns 200 ok', async () => {
    const res = await SELF.fetch('http://x/healthz');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('unknown route returns 404 ApiError', async () => {
    const res = await SELF.fetch('http://x/nope');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ code: 'NOT_FOUND', message: 'Not found' });
  });
});

describe('GET /readyz: the database and the Room', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('200 { status: ready, db: up, room: up } when PostGIS and the Room answer, logging nothing', async () => {
    const log = vi.spyOn(console, 'error');
    const res = await SELF.fetch('http://x/readyz');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ready', db: 'up', room: 'up' });
    // Give workerd's post-end() 'socket closed' event a turn to fire: it must not be logged.
    await new Promise((r) => setTimeout(r, 50));
    expect(log).not.toHaveBeenCalled();
  });

  it('pings getVersion() on the default Room (ROOM.DEFAULT_ROOM_ID)', async () => {
    const names: string[] = [];
    const getVersion = vi.fn(async () => 7);
    const { res } = await readyz(withRoom(getVersion, names));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ready', db: 'up', room: 'up' });
    expect(names).toEqual([ROOM.DEFAULT_ROOM_ID]);
    expect(getVersion).toHaveBeenCalledOnce();
  });

  it('503 NOT_READY { db: down, room: up } when the connection string is unreachable', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { res } = await readyz(withDatabase('postgresql://nobody:x@127.0.0.1:1/none'));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      code: 'NOT_READY',
      message: 'dependency unreachable',
      details: { db: 'down', room: 'up' },
    });
    expect(log).toHaveBeenCalledOnce();
    expect(loggedLine(log)).toEqual({
      level: 'error',
      msg: 'not ready',
      path: '/readyz',
      db: expect.any(String),
    });
  });

  it('503 in time when the database host never answers', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // Non-routable: SYNs are dropped, so only the readiness timeout ends the attempt.
    const { res, elapsed } = await readyz(
      withDatabase('postgresql://nobody:x@10.255.255.1:5432/none'),
    );
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ details: { db: 'down', room: 'up' } });
    expect(elapsed).toBeLessThan(8000);
  }, 15_000);

  it(`503 { db: up, room: down } within TIMEOUTS.DO_PING_MS (${TIMEOUTS.DO_PING_MS} ms) when the Room hangs`, async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { res, elapsed } = await readyz(withRoom(() => new Promise<number>(() => {})));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      code: 'NOT_READY',
      message: 'dependency unreachable',
      details: { db: 'up', room: 'down' },
    });
    expect(elapsed).toBeGreaterThanOrEqual(TIMEOUTS.DO_PING_MS);
    expect(elapsed).toBeLessThan(TIMEOUTS.DO_PING_MS * 2);
    expect(loggedLine(log)).toEqual({
      level: 'error',
      msg: 'not ready',
      path: '/readyz',
      room: `room ping exceeded ${TIMEOUTS.DO_PING_MS} ms`,
    });
  });

  it('503 { db: up, room: down } at once when the Room call fails', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { res, elapsed } = await readyz(
      withRoom(async () => {
        throw new Error('room unavailable');
      }),
    );
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ details: { db: 'up', room: 'down' } });
    expect(elapsed).toBeLessThan(TIMEOUTS.DO_PING_MS);
    expect(loggedLine(log)).toMatchObject({ room: 'room unavailable' });
  });

  it('503 { db: down, room: down } when both fail, one log line', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const bindings = {
      ...withRoom(async () => {
        throw new Error('room unavailable');
      }),
      HYPERDRIVE: { connectionString: 'postgresql://nobody:x@127.0.0.1:1/none' },
    };
    const { res } = await readyz(bindings);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ details: { db: 'down', room: 'down' } });
    expect(log).toHaveBeenCalledOnce();
  });
});
