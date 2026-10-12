import {
  ApiErrorSchema,
  AreaCreateSchema,
  AreaListSchema,
  AreaSchema,
  AreaUpdateSchema,
  BoundsQuerySchema,
  ERROR_CODES,
  ERROR_REASONS,
  ROUTES,
} from '@cgis/shared';
import { type Context, Hono } from 'hono';
import { describeRoute } from 'hono-openapi';
import { z } from 'zod';
import type { AppEnv } from '../app';
import { boundsCache, tileOf } from '../cache/bounds';
import { apiError } from '../errors';
import { mutationGuards, requireUser } from '../middleware';
import { createArea, deleteArea, listAreas, updateArea } from '../services/areas';
import { IdParamSchema, validate } from '../validate';
import { actor, error, json, publish, RATE_LIMITED, UNAUTHORIZED } from './common';
import { revert, versions } from './versions';

// Every path under /api/areas needs a session (401 first, from the one `use` below; an unrouted
// path answers 401, not 404, to an anonymous caller); mutations then mount `mutationGuards()`:
// they spend the user's D5 budget (429) and cap the body (413) before validation (422), so
// rejected attempts count too. Handlers stay thin: services/areas.ts owns the transaction and the
// audit row; a committed change bumps the map version before the response and is broadcast
// after it (`publish`).

/** 422 for a polygon PostGIS rejected: `details.reason` is the `ST_IsValidReason` text. */
const invalidGeometry = (c: Context, reason: string) =>
  apiError(c, ERROR_CODES.UNPROCESSABLE, ERROR_REASONS.INVALID_GEOMETRY, { reason });

const ConflictSchema = ApiErrorSchema.extend({ details: z.object({ current: AreaSchema }) });

const UNPROCESSABLE = error(
  'Invalid request (`UNPROCESSABLE`): `details.issues` from the schema, or `details.reason` when PostGIS rejects the polygon',
);
const PAYLOAD_TOO_LARGE = error('Body over `LIMITS.BODY_MAX_BYTES` (`PAYLOAD_TOO_LARGE`)');
const NOT_FOUND = error('No live area with this id (`NOT_FOUND`)');

/** Mounted at `ROUTES.AREAS` (`/api/areas`). */
export const areas = new Hono<AppEnv>()
  .use(requireUser())
  .post(
    '/',
    describeRoute({
      summary: 'Create an area',
      description:
        'Stores the polygon at version 1 with its geodesic area, and audits `area.create`.',
      responses: {
        201: { description: 'The created area', content: json(AreaSchema) },
        401: UNAUTHORIZED,
        413: PAYLOAD_TOO_LARGE,
        422: UNPROCESSABLE,
        429: RATE_LIMITED,
      },
    }),
    mutationGuards(),
    validate('json', AreaCreateSchema),
    async (c) => {
      const result = await createArea(c.env, c.req.valid('json'), actor(c));
      if (result.status === 'invalid') return invalidGeometry(c, result.reason);
      const { area } = result;
      await publish(c, { type: 'area:created', payload: { area } });
      return c.json(area, 201);
    },
  )
  .get(
    '/',
    describeRoute({
      summary: 'Areas in a viewport',
      description:
        'Live areas whose bounding box meets `bbox` (`w,s,e,n`) snapped outward to the `CACHE.TILE_QUANT_DEG` grid, newest edits first, at most `LIMITS.BOUNDS_LIMIT`. Served from the edge cache while the map version is unchanged (`X-Cache: HIT`, `MISS`, or `BYPASS` when the version is unavailable); `zoom` is part of the cache key. Every 200 but a `BYPASS` carries an `ETag`; `If-None-Match` naming it answers 304.',
      responses: {
        200: { description: 'The areas in the viewport', content: json(AreaListSchema) },
        304: { description: 'Not modified: `If-None-Match` names the current `ETag`' },
        401: UNAUTHORIZED,
        422: UNPROCESSABLE,
      },
    }),
    validate('query', BoundsQuerySchema),
    boundsCache(),
    async (c) => {
      // The tile's envelope, not the viewport: `boundsCache` stores this body for the whole tile.
      const { bbox } = c.req.valid('query');
      return c.json({ areas: await listAreas(c.env, tileOf(bbox).bbox) }, 200);
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
        413: PAYLOAD_TOO_LARGE,
        422: UNPROCESSABLE,
        429: RATE_LIMITED,
      },
    }),
    mutationGuards(),
    validate('param', IdParamSchema),
    validate('json', AreaUpdateSchema),
    async (c) => {
      const { id } = c.req.valid('param');
      const result = await updateArea(c.env, id, c.req.valid('json'), actor(c));
      switch (result.status) {
        case 'invalid':
          return invalidGeometry(c, result.reason);
        case 'missing':
          return apiError(c, ERROR_CODES.NOT_FOUND);
        case 'conflict':
          return apiError(c, ERROR_CODES.CONFLICT, ERROR_REASONS.VERSION_CONFLICT, {
            current: result.current,
          });
        case 'updated': {
          const { area } = result;
          await publish(c, { type: 'area:updated', payload: { area } });
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
    mutationGuards(),
    validate('param', IdParamSchema),
    async (c) => {
      const { id } = c.req.valid('param');
      const result = await deleteArea(c.env, id, actor(c));
      if (result.status === 'missing') return apiError(c, ERROR_CODES.NOT_FOUND);
      await publish(c, { type: 'area:deleted', payload: { id } });
      return c.body(null, 204);
    },
  )
  .route(ROUTES.AREA_VERSIONS, versions)
  .route(ROUTES.AREA_REVERT, revert);
