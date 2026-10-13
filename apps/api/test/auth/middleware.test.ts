import { LOG, TIMEOUTS } from '@cgis/shared';
import { SELF } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app';
import { log, requestFields } from '../../src/log';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const OTHER_ORIGIN = 'https://evil.example';

/** The real app (real chain, real onError) plus test-only routes. */
function testApp() {
  const app = createApp();
  app.get('/t/id', (c) => c.json({ requestId: c.get('requestId') }));
  app.get('/t/slow', async (c) => {
    await new Promise((resolve) => setTimeout(resolve, TIMEOUTS.REQUEST_MS * 2));
    return c.text('too late');
  });
  app.get('/t/ws', () => {
    const pair = new WebSocketPair();
    pair[1].accept();
    return new Response(null, { status: 101, webSocket: pair[0] });
  });
  app.post('/t/log/:level', async (c) => {
    c.set('user', { id: 'user-1', name: 'Ada' });
    const level = c.req.param('level') as 'info' | 'warn';
    log(level, 'signed in', { ...requestFields(c), ...(await c.req.json()) });
    return c.body(null, 204);
  });
  return app;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('CORS (TOM-27)', () => {
  const preflight = (origin: string) =>
    SELF.fetch('http://x/api/areas', {
      method: 'OPTIONS',
      headers: {
        origin,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type',
      },
    });

  it('a preflight from CLIENT_ORIGIN gets 204 with that origin and credentials allowed', async () => {
    const res = await preflight(env.CLIENT_ORIGIN);
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe(env.CLIENT_ORIGIN);
    expect(res.headers.get('access-control-allow-credentials')).toBe('true');
    expect(res.headers.get('access-control-allow-methods')).toContain('POST');
    expect(res.headers.get('access-control-allow-headers')).toBe('content-type');
    expect(res.headers.get('vary')).toContain('Origin');
  });

  it('a preflight from any other origin gets no allow-origin header', async () => {
    const res = await preflight(OTHER_ORIGIN);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('a simple request echoes CLIENT_ORIGIN only, never a wildcard', async () => {
    const ours = await SELF.fetch('http://x/healthz', { headers: { origin: env.CLIENT_ORIGIN } });
    expect(ours.headers.get('access-control-allow-origin')).toBe(env.CLIENT_ORIGIN);
    expect(ours.headers.get('access-control-allow-credentials')).toBe('true');
    expect(ours.headers.get('vary')).toContain('Origin');

    const theirs = await SELF.fetch('http://x/healthz', { headers: { origin: OTHER_ORIGIN } });
    expect(theirs.headers.get('access-control-allow-origin')).toBeNull();

    const none = await SELF.fetch('http://x/healthz');
    expect(none.headers.get('access-control-allow-origin')).toBeNull();
  });
});

describe('secure headers (TOM-27)', () => {
  it.each(['/healthz', '/api/areas/nope'])(
    '%s carries the secureHeaders defaults',
    async (path) => {
      const res = await SELF.fetch(`http://x${path}`);
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      expect(res.headers.get('x-frame-options')).toBe('SAMEORIGIN');
      expect(res.headers.get('referrer-policy')).toBe('no-referrer');
      expect(res.headers.get('strict-transport-security')).toContain('max-age=');
    },
  );
});

describe('request id (TOM-31)', () => {
  it('every response carries a fresh UUID in x-request-id', async () => {
    const a = await SELF.fetch('http://x/healthz');
    const b = await SELF.fetch('http://x/api/areas/nope');
    expect(a.headers.get('x-request-id')).toMatch(UUID);
    expect(b.headers.get('x-request-id')).toMatch(UUID);
    expect(a.headers.get('x-request-id')).not.toBe(b.headers.get('x-request-id'));
  });

  it("handlers read the same id with c.get('requestId')", async () => {
    const res = await testApp().request('http://x/t/id', {}, env);
    expect(await res.json()).toEqual({ requestId: res.headers.get('x-request-id') });
  });

  it.each(['edge-42', 'a b"}'])(
    'ignores an incoming x-request-id (%s): the id is always server-generated',
    async (incoming) => {
      const res = await testApp().request(
        'http://x/t/id',
        { headers: { 'x-request-id': incoming } },
        env,
      );
      const id = res.headers.get('x-request-id');
      expect(id).toMatch(UUID);
      expect(await res.json()).toEqual({ requestId: id });
    },
  );
});

describe('request timeout (2.6)', () => {
  it('a handler slower than TIMEOUTS.REQUEST_MS answers 504 TIMEOUT via onError', async () => {
    vi.useFakeTimers();
    const pending = testApp().request(
      'http://x/t/slow',
      { headers: { origin: env.CLIENT_ORIGIN } },
      env,
    );
    await vi.advanceTimersByTimeAsync(TIMEOUTS.REQUEST_MS);
    const res = await pending;
    expect(res.status).toBe(504);
    expect(await res.json()).toEqual({ code: 'TIMEOUT', message: 'timeout' });
    // The browser can read the error and the logs can be correlated.
    expect(res.headers.get('x-request-id')).toMatch(UUID);
    expect(res.headers.get('access-control-allow-origin')).toBe(env.CLIENT_ORIGIN);
  });
});

describe('WebSocket upgrades pass through the chain', () => {
  it('a 101 response keeps its status and webSocket', async () => {
    const res = await testApp().request(
      'http://x/t/ws',
      { headers: { upgrade: 'websocket', origin: env.CLIENT_ORIGIN } },
      env,
    );
    expect(res.status).toBe(101);
    expect(res.webSocket).not.toBeNull();
    res.webSocket?.accept();
    res.webSocket?.close();
  });
});

describe('log() (TOM-31)', () => {
  it('writes one JSON line with request id, user id and path, secrets redacted at any depth', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const res = await testApp().request(
      'http://x/t/log/info',
      {
        method: 'POST',
        body: JSON.stringify({
          email: 'ada@example.com',
          password: 'hunter2',
          headers: { Authorization: 'Bearer tok', 'set-cookie': 'sid=abc', accept: 'json' },
          BETTER_AUTH_SECRET: 's3cr3t',
        }),
      },
      env,
    );
    expect(res.status).toBe(204);
    expect(info).toHaveBeenCalledOnce();
    const line = String(info.mock.calls[0]?.[0]);
    expect(line).not.toMatch(/hunter2|Bearer tok|sid=abc|s3cr3t/);
    expect(line.includes('\n')).toBe(false);
    expect(JSON.parse(line)).toEqual({
      level: 'info',
      msg: 'signed in',
      requestId: res.headers.get('x-request-id'),
      userId: 'user-1',
      path: '/t/log/info',
      email: 'ada@example.com',
      password: LOG.REDACTED,
      headers: { Authorization: LOG.REDACTED, 'set-cookie': LOG.REDACTED, accept: 'json' },
      BETTER_AUTH_SECRET: LOG.REDACTED,
    });
  });

  it('writes to the console method of its level', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await testApp().request('http://x/t/log/warn', { method: 'POST', body: '{}' }, env);
    expect(warn).toHaveBeenCalledOnce();
    expect(JSON.parse(String(warn.mock.calls[0]?.[0]))).toMatchObject({ level: 'warn' });
  });
});
