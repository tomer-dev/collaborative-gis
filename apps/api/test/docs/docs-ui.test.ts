import { OPENAPI, ROUTES } from '@cgis/shared';
import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

/** The deployed Worker's own fetch: app.ts mounts the docs UI (`app.route('/', docs)`). */
const get = () => SELF.fetch(`http://x${ROUTES.DOCS}`);

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

  it('loads the pinned script with Subresource Integrity, so a changed CDN file never runs', async () => {
    const html = await (await get()).text();
    expect(html).toContain(
      `<script src="${OPENAPI.UI_BUNDLE}" integrity="${OPENAPI.UI_BUNDLE_INTEGRITY}" crossorigin="anonymous">`,
    );
    // One script from outside the page: the signed one (the rest is the inline initialiser).
    expect(html.match(/<script [^>]*src=/g)).toHaveLength(1);
  });

  it('sits behind the cross-cutting middleware', async () => {
    const res = await get();
    expect(res.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });
});
