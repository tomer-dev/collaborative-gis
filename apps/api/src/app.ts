import { ROUTES } from '@cgis/shared';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { authHandler } from './auth';
import { httpExceptionError, internalError, notFoundError } from './errors';
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

/** The one composition point: lanes fill the mounted modules, not this file. */
export function createApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use('*', middleware());
  app.route('/', health);
  app.all(`${ROUTES.AUTH}/*`, authHandler);
  app.route(ROUTES.AREAS, areas);
  app.get(ROUTES.WS, wsUpgrade);

  app.notFound((c) => notFoundError(c));

  app.onError((err, c) => {
    // Deliberate HTTP errors (auth, validation, ...) keep their status and message.
    if (err instanceof HTTPException) return httpExceptionError(c, err);
    console.error(
      JSON.stringify({
        level: 'error',
        msg: err.message,
        path: c.req.path,
        stack: err instanceof Error ? err.stack : undefined,
      }),
    );
    return internalError(c);
  });

  return app;
}
