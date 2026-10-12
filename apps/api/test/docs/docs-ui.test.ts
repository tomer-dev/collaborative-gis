import { OPENAPI, ROUTES } from '@cgis/shared';
import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

/** The deployed Worker's own fetch: app.ts mounts the docs UI (`app.route('/', docs)`). */
const get = (init: RequestInit = {}) => SELF.fetch(`http://x${ROUTES.DOCS}`, init);

describe(`GET ${ROUTES.DOCS}`, () => {
  it('serves the API reference HTML pointing at the OpenAPI document, without a session', async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/html/);
    const html = await res.text();
    expect(html).toContain(`"${ROUTES.OPENAPI}"`);
    expect(html).toContain(OPENAPI.TITLE);
    // The UI script is a pinned release, never the CDN's moving latest.
    expect(html).toContain(OPENAPI.UI_BUNDLE);
  });

  it('sits behind the cross-cutting middleware', async () => {
    const res = await get();
    expect(res.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('answers only GET', async () => {
    const res = await get({ method: 'POST' });
    expect(res.status).toBe(404);
  });
});
