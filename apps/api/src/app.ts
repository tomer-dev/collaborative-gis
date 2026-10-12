import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { httpExceptionError, internalError, notFoundError } from './errors';
import { health } from './routes/health';

// Generated from wrangler.jsonc by `pnpm types` (worker-configuration.d.ts); never hand-written.
export type Env = CloudflareBindings;

export function createApp(): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();

  app.route('/', health);

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
