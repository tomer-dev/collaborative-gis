import { ApiErrorSchema, HEADERS } from '@cgis/shared';
import type { Context } from 'hono';
import { resolver } from 'hono-openapi';
import type { AppEnv } from '../app';
import type { SignedIn } from '../middleware';
import type { Actor } from '../services/areas';

// What the area routes (areas.ts) and their version routes (versions.ts) share.

/** The session user, the client hints and the request id the audit row records. */
export function actor(c: Context<AppEnv & SignedIn>): Actor {
  return {
    userId: c.get('user').id,
    ip: c.req.header(HEADERS.CF_CONNECTING_IP) ?? null,
    userAgent: c.req.header(HEADERS.USER_AGENT) ?? null,
    requestId: c.get('requestId'),
  };
}

/** OpenAPI `content` for a JSON body described by `schema`. */
export const json = (schema: Parameters<typeof resolver>[0]) => ({
  'application/json': { schema: resolver(schema) },
});

/** An OpenAPI error response: the `ApiError` body, with `description`. */
export const error = (description: string) => ({ description, content: json(ApiErrorSchema) });

export const UNAUTHORIZED = error('No session (`UNAUTHORIZED`)');
export const RATE_LIMITED = error(
  'Over the per-user mutation budget (`RATE_LIMITED`), with `Retry-After`',
);
