import type { ApiError } from '@cgis/shared';
import { Hono } from 'hono';
import { health } from './routes/health';

export type Env = {
  // HYPERDRIVE is added in Task 5; optional here so /readyz fails closed without it.
  HYPERDRIVE?: Hyperdrive;
};

export function createApp() {
  const app = new Hono<{ Bindings: Env }>();

  app.route('/', health);

  app.notFound((c) => c.json<ApiError>({ code: 'NOT_FOUND', message: 'Not found' }, 404));

  app.onError((err, c) => {
    console.error(JSON.stringify({ level: 'error', msg: err.message, path: c.req.path }));
    return c.json<ApiError>({ code: 'INTERNAL', message: 'Internal Server Error' }, 500);
  });

  return app;
}
