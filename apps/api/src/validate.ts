import { ERROR_CODES, ERROR_MESSAGES } from '@cgis/shared';
import { validator } from 'hono-openapi';
import type { ValidationTargets } from 'hono';
import { z } from 'zod';
import { apiError } from './errors';

type Schema = Parameters<typeof validator>[1];

/**
 * `hono-openapi`'s `validator` (so the schema also lands in `/openapi.json`) with the API's error
 * shape: a request that fails `schema` is answered 422
 * `{ code: 'UNPROCESSABLE', message: 'Unprocessable', details: { issues } }`, where `issues` are
 * the schema's Standard Schema issues (`message`, `path`, ...). `c.req.valid(target)` is the parsed
 * output in the handlers after it. A body that is not JSON at all still gets Hono's 400.
 */
export const validate = <Target extends keyof ValidationTargets, S extends Schema>(
  target: Target,
  schema: S,
) =>
  validator(target, schema, (result, c) => {
    if (!result.success) {
      return apiError(c, ERROR_CODES.UNPROCESSABLE, ERROR_MESSAGES.UNPROCESSABLE, {
        issues: result.error,
      });
    }
  });

/**
 * `:id` must be a UUID before it reaches SQL: Postgres would reject anything else as
 * `invalid input syntax for type uuid` (22P02), a 500 instead of a 422.
 */
export const IdParamSchema = z.object({ id: z.uuid() });
