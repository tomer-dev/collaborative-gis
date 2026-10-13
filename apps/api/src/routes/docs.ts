import { OPENAPI, ROUTES } from '@cgis/shared';
import { Hono } from 'hono';
import type { AppEnv } from '../app';

/**
 * `GET /docs`: the API reference UI (Scalar's pinned single-file build), rendering
 * `GET /openapi.json` in the browser. Public and read-only like the document itself; `app.ts`
 * mounts it after the cross-cutting middleware (`app.route('/', docs)`), so it carries the request
 * id and secure headers like every route. The page runs a CDN script on the API's origin, next to
 * the session cookie, so the script tag carries `integrity`: the browser refuses any bytes but the
 * pinned release's.
 */
const PAGE = `<!doctype html>
<html>
  <head>
    <title>${OPENAPI.TITLE}</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body>
    <div id="app"></div>
    <script src="${OPENAPI.UI_BUNDLE}" integrity="${OPENAPI.UI_BUNDLE_INTEGRITY}" crossorigin="anonymous"></script>
    <script>Scalar.createApiReference('#app', ${JSON.stringify({ url: ROUTES.OPENAPI })})</script>
  </body>
</html>`;

export const docs = new Hono<AppEnv>().get(ROUTES.DOCS, (c) => c.html(PAGE));
