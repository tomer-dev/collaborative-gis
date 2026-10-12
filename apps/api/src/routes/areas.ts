import {
  ApiErrorSchema,
  AreaCreateSchema,
  AreaListSchema,
  AreaSchema,
  AreaUpdateSchema,
  BoundsQuerySchema,
  ERROR_CODES,
  ERROR_REASONS,
  HEADERS,
  RATE_LIMIT,
  ROUTES,
} from '@cgis/shared';
import { type Context, Hono } from 'hono';
import { describeRoute, resolver } from 'hono-openapi';
import { z } from 'zod';
import type { AppEnv } from '../app';
import { apiError, notFoundError } from '../errors';
import { requireUser } from '../middleware';
import { rateLimit } from '../middleware/rate-limit';
import { type Actor, createArea, deleteArea, listAreas, updateArea } from '../services/areas';
import { fanout } from '../services/fanout';
import { IdParamSchema, validate } from '../validate';

// Every route needs a session (401 first); mutations then spend the user's D5 budget (429) before
// validation (422), so rejected attempts count too. Handlers stay thin: services/areas.ts owns the
// transaction and the audit row, and a committed change is broadcast after the response.

const mutation = () => rateLimit(RATE_LIMIT.ACTIONS.MUTATE);

/** The session user and the client hints the audit row records. */
function actor(c: Context, userId: string): Actor {
  return {
    userId,
    ip: c.req.header(HEADERS.CF_CONNECTING_IP) ?? null,
    userAgent: c.req.header(HEADERS.USER_AGENT) ?? null,
  };
}

/** 422 for a polygon PostGIS rejected: `details.reason` is the `ST_IsValidReason` text. */
const invalidGeometry = (c: Context, reason: string) =>
  apiError(c, ERROR_CODES.UNPROCESSABLE, ERROR_REASONS.INVALID_GEOMETRY, { reason });

const ConflictSchema = ApiErrorSchema.extend({ details: z.object({ current: AreaSchema }) });

const json = (schema: Parameters<typeof resolver>[0]) => ({
  'application/json': { schema: resolver(schema) },
});
const error = (description: string) => ({ description, content: json(ApiErrorSchema) });
const UNAUTHORIZED = error('No session (`UNAUTHORIZED`)');
const UNPROCESSABLE = error(
  'Invalid request (`UNPROCESSABLE`): `details.issues` from the schema, or `details.reason` when PostGIS rejects the polygon',
);
const RATE_LIMITED = error(
  'Over the per-user mutation budget (`RATE_LIMITED`), with `Retry-After`',
);
const NOT_FOUND = error('No live area with this id (`NOT_FOUND`)');

/** Mounted at `ROUTES.AREAS` (`/api/areas`). */
export const areas = new Hono<AppEnv>()
  .post(
    '/',
    describeRoute({
      summary: 'Create an area',
      description:
        'Stores the polygon at version 1 with its geodesic area, and audits `area.create`.',
      responses: {
        201: { description: 'The created area', content: json(AreaSchema) },
        401: UNAUTHORIZED,
        422: UNPROCESSABLE,
        429: RATE_LIMITED,
      },
    }),
    requireUser(),
    mutation(),
    validate('json', AreaCreateSchema),
    async (c) => {
      const result = await createArea(c.env, c.req.valid('json'), actor(c, c.get('user').id));
      if (result.status === 'invalid') return invalidGeometry(c, result.reason);
      const { area } = result;
      c.executionCtx.waitUntil(fanout(c.env, { type: 'area:created', payload: { area } }));
      return c.json(area, 201);
    },
  )
  .get(
    '/',
    describeRoute({
      summary: 'Areas in a viewport',
      description:
        'Live areas whose bounding box meets `bbox` (`w,s,e,n`), newest edits first, at most `LIMITS.BOUNDS_LIMIT`. `zoom` is accepted and not used yet.',
      responses: {
        200: { description: 'The areas in the viewport', content: json(AreaListSchema) },
        401: UNAUTHORIZED,
        422: UNPROCESSABLE,
      },
    }),
    requireUser(),
    validate('query', BoundsQuerySchema),
    async (c) => {
      // `zoom` is validated but unused until the M2 tile cache keys on it.
      const { bbox } = c.req.valid('query');
      return c.json({ areas: await listAreas(c.env, bbox) }, 200);
    },
  )
  .put(
    ROUTES.AREA_BY_ID,
    describeRoute({
      summary: 'Update an area',
      description:
        'Optimistic concurrency: applies only when `version` is the stored version, bumps it, and audits `area.update`.',
      responses: {
        200: { description: 'The updated area', content: json(AreaSchema) },
        401: UNAUTHORIZED,
        404: NOT_FOUND,
        409: {
          description: 'Stale `version` (`CONFLICT`): `details.current` is the stored area',
          content: json(ConflictSchema),
        },
        422: UNPROCESSABLE,
        429: RATE_LIMITED,
      },
    }),
    requireUser(),
    mutation(),
    validate('param', IdParamSchema),
    validate('json', AreaUpdateSchema),
    async (c) => {
      const { id } = c.req.valid('param');
      const result = await updateArea(c.env, id, c.req.valid('json'), actor(c, c.get('user').id));
      switch (result.status) {
        case 'invalid':
          return invalidGeometry(c, result.reason);
        case 'missing':
          return notFoundError(c);
        case 'conflict':
          return apiError(c, ERROR_CODES.CONFLICT, ERROR_REASONS.VERSION_CONFLICT, {
            current: result.current,
          });
        case 'updated': {
          const { area } = result;
          c.executionCtx.waitUntil(fanout(c.env, { type: 'area:updated', payload: { area } }));
          return c.json(area, 200);
        }
      }
    },
  )
  .delete(
    ROUTES.AREA_BY_ID,
    describeRoute({
      summary: 'Delete an area',
      description:
        'Soft delete: bumps the version, hides the area from viewports, and audits `area.delete`.',
      responses: {
        204: { description: 'Deleted' },
        401: UNAUTHORIZED,
        404: NOT_FOUND,
        422: UNPROCESSABLE,
        429: RATE_LIMITED,
      },
    }),
    requireUser(),
    mutation(),
    validate('param', IdParamSchema),
    async (c) => {
      const { id } = c.req.valid('param');
      const result = await deleteArea(c.env, id, actor(c, c.get('user').id));
      if (result.status === 'missing') return notFoundError(c);
      c.executionCtx.waitUntil(fanout(c.env, { type: 'area:deleted', payload: { id } }));
      return c.body(null, 204);
    },
  );
