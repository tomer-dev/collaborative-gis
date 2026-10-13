import {
  ApiErrorSchema,
  AreaSchema,
  ERROR_CODES,
  ERROR_MESSAGES,
  ERROR_REASONS,
  LIMITS,
  RevertRequestSchema,
  VersionsResponseSchema,
} from '@cgis/shared';
import { Hono } from 'hono';
import { describeRoute } from 'hono-openapi';
import { z } from 'zod';
import type { AppEnv } from '../app';
import { apiError } from '../errors';
import { mutationGuards } from '../middleware';
import { listAreaVersions, revertAreaToVersion } from '../services/areas';
import { IdParamSchema, validate } from '../validate';
import { actor, error, json, publish, RATE_LIMITED, UNAUTHORIZED } from './common';

// An area's saved versions, and the revert to one of them; routes/areas.ts mounts both behind its
// `requireUser()` (401 first); the revert, like every mutation, mounts `mutationGuards()` (the
// user's D5 budget (429) and the body cap (413)) before validation (422). A revert names the version it is based on and meets the same 409 as a `PUT`
// when the area moved on (D4). services/areas.ts owns the transaction and the audit row; a
// committed revert bumps the map version before the response and is broadcast after it.

/**
 * `:version` is an `area_versions.version`, a Postgres integer: past the int4 range the query
 * itself would fail (22003), a 500 instead of a 422. The checks sit on the coerced number itself
 * (not a pipe), so the OpenAPI document reads them: `integer`, 1 to `LIMITS.VERSION_MAX`.
 */
const RevertParamSchema = IdParamSchema.extend({
  version: z.coerce.number().int().positive().max(LIMITS.VERSION_MAX),
});

/** The two 409s: the area is deleted (`details.reason`), or it moved on (`details.current`, D4). */
const RevertConflictSchema = z.union([
  ApiErrorSchema.extend({ details: z.object({ reason: z.string() }) }),
  ApiErrorSchema.extend({ details: z.object({ current: AreaSchema }) }),
]);

const UNPROCESSABLE = error('Invalid path parameter (`UNPROCESSABLE`): `details.issues`');

/** Mounted at `ROUTES.AREA_VERSIONS` (`/api/areas/:id/versions`). */
export const versions = new Hono<AppEnv>().get(
  '/',
  describeRoute({
    summary: 'Versions of an area',
    description:
      'The saved versions of a live area, newest first and at most `LIMITS.VERSIONS_PAGE` (200): its name, geometry and area at that version, who saved it (`changedBy`, and `authorName`: their display name, null when the user is gone) and when.',
    responses: {
      200: { description: 'The versions, newest first', content: json(VersionsResponseSchema) },
      401: UNAUTHORIZED,
      404: error('No live area with this id (`NOT_FOUND`)'),
      422: UNPROCESSABLE,
    },
  }),
  validate('param', IdParamSchema),
  async (c) => {
    const { id } = c.req.valid('param');
    const versions = await listAreaVersions(c.env, id);
    if (!versions) return apiError(c, ERROR_CODES.NOT_FOUND);
    return c.json({ versions }, 200);
  },
);

/** Mounted at `ROUTES.AREA_REVERT` (`/api/areas/:id/revert/:version`). */
export const revert = new Hono<AppEnv>().post(
  '/',
  describeRoute({
    summary: 'Revert an area to a saved version',
    description:
      'Saves that version’s name and geometry as a new version (the history is kept), bumps `version`, and audits `area.revert`. The body’s `version` is the area’s version the client was showing: optimistic concurrency like `PUT` (D4).',
    responses: {
      201: { description: 'The area at its new version', content: json(AreaSchema) },
      401: UNAUTHORIZED,
      404: error('No such area, or no such version of it (`NOT_FOUND`)'),
      409: {
        description:
          'The area is deleted (`CONFLICT`, `details.reason`), or it is no longer at the body’s `version` (`CONFLICT`, `details.current` is the stored area)',
        content: json(RevertConflictSchema),
      },
      422: UNPROCESSABLE,
      429: RATE_LIMITED,
    },
  }),
  mutationGuards(),
  validate('param', RevertParamSchema),
  validate('json', RevertRequestSchema),
  async (c) => {
    const { id, version } = c.req.valid('param');
    const expected = c.req.valid('json').version;
    const result = await revertAreaToVersion(c.env, id, { version, expected }, actor(c));
    switch (result.status) {
      case 'missing':
        return apiError(c, ERROR_CODES.NOT_FOUND);
      case 'deleted':
        return apiError(c, ERROR_CODES.CONFLICT, ERROR_MESSAGES.CONFLICT, {
          reason: ERROR_REASONS.AREA_DELETED,
        });
      case 'conflict':
        return apiError(c, ERROR_CODES.CONFLICT, ERROR_REASONS.VERSION_CONFLICT, {
          current: result.current,
        });
      case 'reverted': {
        const { area } = result;
        await publish(c, { type: 'area:updated', payload: { area } });
        return c.json(area, 201);
      }
    }
  },
);
