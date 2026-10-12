import { ERROR_CODES, OPENAPI, ROUTES } from '@cgis/shared';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { openAPIRouteHandler } from 'hono-openapi';
import { authHandler } from './auth';
import { apiError, httpExceptionError } from './errors';
import { log, requestFields } from './log';
import { middleware } from './middleware';
import { areas } from './routes/areas';
import { health } from './routes/health';
import { wsUpgrade } from './ws';

// Generated from wrangler.jsonc by `pnpm types` (worker-configuration.d.ts); never hand-written.
export type Env = CloudflareBindings;

export type AppEnv = {
  Bindings: Env;
  Variables: { user?: { id: string; name: string }; requestId: string };
};

/**
 * The one composition point: lanes fill the mounted modules, not this file. Returns the app typed
 * with the `/api/areas` routes' schema (`AppType`).
 */
export function createApp() {
  const app = new Hono<AppEnv>();

  app.use('*', middleware());
  app.route('/', health);
  app.all(`${ROUTES.AUTH}/*`, authHandler);
  // `route` returns this same app, typed with the areas schema: that is the type createApp returns.
  const typed = app.route(ROUTES.AREAS, areas);
  app.get(ROUTES.WS, wsUpgrade);
  // Documents the routes that carry `describeRoute`/`validate` metadata (today: /api/areas).
  // Public, like the routes' shapes in the SPA bundle; validation failures are documented as the
  // 422s the routes declare, not hono-openapi's default 400.
  app.get(
    ROUTES.OPENAPI,
    openAPIRouteHandler(app, {
      documentation: { info: { title: OPENAPI.TITLE, version: OPENAPI.VERSION } },
      defaultValidationErrorResponse: false,
    }),
  );

  app.notFound((c) => apiError(c, ERROR_CODES.NOT_FOUND));

  app.onError((err, c) => {
    // Deliberate HTTP errors (auth, validation, ...) keep their status and message.
    if (err instanceof HTTPException) return httpExceptionError(c, err);
    log('error', err.message, { ...requestFields(c), stack: err.stack });
    return apiError(c, ERROR_CODES.INTERNAL);
  });

  return typed;
}

/** D19: the SPA's Hono `hc` client is typed from this (`hc<AppType>(origin)`). */
export type AppType = ReturnType<typeof createApp>;
