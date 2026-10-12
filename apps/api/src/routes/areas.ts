import { Hono } from 'hono';
import type { AppEnv } from '../app';

/** Mounted at `/api/areas`. Stub: M1 T15 (api lane) adds the routes. */
export const areas = new Hono<AppEnv>();
