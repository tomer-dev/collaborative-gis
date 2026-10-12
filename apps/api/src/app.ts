import { Hono } from 'hono';
import { internalError, notFoundError } from './errors';
import { health } from './routes/health';

export type Env = {
  HYPERDRIVE: Hyperdrive;
};

export function createApp() {
  const app = new Hono<{ Bindings: Env }>();

  app.route('/', health);

  app.notFound((c) => notFoundError(c));

  app.onError((err, c) => {
    console.error(JSON.stringify({ level: 'error', msg: err.message, path: c.req.path }));
    return internalError(c);
  });

  return app;
}
