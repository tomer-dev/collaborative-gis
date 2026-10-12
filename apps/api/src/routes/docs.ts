import { OPENAPI, ROUTES } from '@cgis/shared';
import { Scalar } from '@scalar/hono-api-reference';
import { Hono } from 'hono';
import type { AppEnv } from '../app';

/**
 * `GET /docs`: the API reference UI (Scalar), rendering `GET /openapi.json` in the browser. Public
 * and read-only like the document itself; `app.ts` mounts it after the cross-cutting middleware
 * (`app.route('/', docs)`), so it carries the request id and secure headers like every route.
 */
export const docs = new Hono<AppEnv>().get(
  ROUTES.DOCS,
  Scalar({ url: ROUTES.OPENAPI, pageTitle: OPENAPI.TITLE, bundle: OPENAPI.UI_BUNDLE }),
);
