import { SELF } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('health', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('GET /healthz returns 200 ok', async () => {
    const res = await SELF.fetch('http://x/healthz');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('GET /readyz returns 200 with db up when PostGIS answers, logging nothing', async () => {
    const log = vi.spyOn(console, 'error');
    const res = await SELF.fetch('http://x/readyz');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, db: 'up' });
    // Give workerd's post-end() 'socket closed' event a turn to fire: it must not be logged.
    await new Promise((r) => setTimeout(r, 50));
    expect(log).not.toHaveBeenCalled();
  });

  it('GET /readyz returns 503 ApiError when the connection string is unreachable', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { createApp } = await import('../src/app');
    const app = createApp();
    const res = await app.request(
      'http://x/readyz',
      {},
      {
        HYPERDRIVE: { connectionString: 'postgresql://nobody:x@127.0.0.1:1/none' } as Hyperdrive,
      },
    );
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ code: 'NOT_READY', message: 'database unreachable' });
    expect(log).toHaveBeenCalledOnce();
  });

  it('GET /readyz answers 503 in time when the host never answers', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { createApp } = await import('../src/app');
    const app = createApp();
    // Non-routable: SYNs are dropped, so only the readiness timeout ends the attempt.
    const connectionString = 'postgresql://nobody:x@10.255.255.1:5432/none';
    const started = Date.now();
    const res = await app.request(
      'http://x/readyz',
      {},
      {
        HYPERDRIVE: { connectionString } as Hyperdrive,
      },
    );
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ code: 'NOT_READY', message: 'database unreachable' });
    expect(Date.now() - started).toBeLessThan(8000);
    expect(log).toHaveBeenCalledOnce();
  }, 15_000);

  it('unknown route returns 404 ApiError', async () => {
    const res = await SELF.fetch('http://x/nope');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ code: 'NOT_FOUND', message: 'Not found' });
  });
});
