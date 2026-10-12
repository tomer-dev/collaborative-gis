import { OPENAPI, ROUTES } from '@cgis/shared';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { docs } from '../../src/routes/docs';

/** The app with the docs UI mounted the way `app.ts` mounts it: `app.route('/', docs)`. */
const app = () => createApp().route('/', docs);

describe(`GET ${ROUTES.DOCS}`, () => {
  it('serves the API reference HTML pointing at the OpenAPI document, without a session', async () => {
    const res = await app().request(ROUTES.DOCS, {}, env);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/html/);
    const html = await res.text();
    expect(html).toContain(`"${ROUTES.OPENAPI}"`);
    expect(html).toContain(OPENAPI.TITLE);
    // The UI script is a pinned release, never the CDN's moving latest.
    expect(html).toContain(OPENAPI.UI_BUNDLE);
  });

  it('sits behind the cross-cutting middleware', async () => {
    const res = await app().request(ROUTES.DOCS, {}, env);
    expect(res.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('answers only GET', async () => {
    const res = await app().request(ROUTES.DOCS, { method: 'POST' }, env);
    expect(res.status).toBe(404);
  });
});
