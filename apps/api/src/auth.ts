import type { Handler } from 'hono';
import type { AppEnv } from './app';
import { notImplementedError } from './errors';

/** Serves `/api/auth/*`. Stub: M1 T4 (auth lane) hands the request to Better Auth. */
export const authHandler: Handler<AppEnv> = (c) => notImplementedError(c);
