import { OPENAPI, ROUTES } from '@cgis/shared';
import { Scalar } from '@scalar/hono-api-reference';
import { Hono } from 'hono';
import type { AppEnv } from '../app';

/** Scalar's page with the pinned single-file build (`cdn`: one `<script src>`, no chunks). */
const reference = Scalar({ url: ROUTES.OPENAPI, pageTitle: OPENAPI.TITLE, cdn: OPENAPI.UI_BUNDLE });

/** The tag Scalar writes for that build, and the same tag with its Subresource Integrity. */
const SCRIPT_TAG = `<script src="${OPENAPI.UI_BUNDLE}"`;
const SIGNED_TAG = `${SCRIPT_TAG} integrity="${OPENAPI.UI_BUNDLE_INTEGRITY}" crossorigin="anonymous"`;

/**
 * `GET /docs`: the API reference UI (Scalar), rendering `GET /openapi.json` in the browser. Public
 * and read-only like the document itself; `app.ts` mounts it after the cross-cutting middleware
 * (`app.route('/', docs)`), so it carries the request id and secure headers like every route.
 *
 * The page runs a CDN script on the API's origin, next to the session cookie, so the script tag
 * carries `integrity`: the browser refuses any bytes but the pinned release's. Scalar's renderer
 * has no option for it, so the tag is signed here; a renderer that stops writing it fails the
 * request (and the docs test) instead of serving the script unsigned.
 */
export const docs = new Hono<AppEnv>()
  .use(ROUTES.DOCS, async (c, next) => {
    await next();
    // Only the page itself (a 404 for another method passes through unchanged).
    if (c.res.status !== 200) return;
    const html = await c.res.text();
    if (!html.includes(SCRIPT_TAG)) throw new Error('the docs page has no script tag to sign');
    const { status, headers } = c.res;
    c.res = new Response(html.replace(SCRIPT_TAG, SIGNED_TAG), { status, headers });
  })
  .get(ROUTES.DOCS, reference);
