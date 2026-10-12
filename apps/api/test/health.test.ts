import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

describe('health', () => {
  it('GET /healthz returns 200 ok', async () => {
    const res = await SELF.fetch('http://x/healthz');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('GET /readyz returns 503 ApiError when the database check throws', async () => {
    // No HYPERDRIVE binding is configured in this task, so the probe must fail closed.
    const res = await SELF.fetch('http://x/readyz');
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toEqual({ code: 'NOT_READY', message: 'database unreachable' });
  });

  it('unknown route returns 404 ApiError', async () => {
    const res = await SELF.fetch('http://x/nope');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ code: 'NOT_FOUND', message: 'Not found' });
  });
});
