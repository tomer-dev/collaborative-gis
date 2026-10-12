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
    const body = (await res.json()) as { code: string; message: string };
    expect(body.code).toBe('NOT_READY');
    expect(typeof body.message).toBe('string');
  });

  it('unknown route returns 404 ApiError', async () => {
    const res = await SELF.fetch('http://x/nope');
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe('NOT_FOUND');
  });
});
