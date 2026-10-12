import type { Handler } from 'hono';
import type { AppEnv } from './app';
import { notImplementedError } from './errors';

/** Serves `GET /ws`. Stub: M1 T6 (realtime lane) upgrades to the `Room` Durable Object. */
export const wsUpgrade: Handler<AppEnv> = (c) => notImplementedError(c);
