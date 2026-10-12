import { ApiErrorSchema, type AreaEvent, HEADERS } from '@cgis/shared';
import type { Context } from 'hono';
import { resolver } from 'hono-openapi';
import type { AppEnv } from '../app';
import type { SignedIn } from '../middleware';
import type { Actor } from '../services/areas';
import { bumpMapVersion, fanout } from '../services/fanout';

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

/**
 * A committed area change, before the response: bumps the map version (awaited, so no bounds read
 * after this response finds or stores the pre-write tile under the old key), then broadcasts the
 * event in `waitUntil`, stamped with that version, without holding the response.
 */
export async function publish(c: Context<AppEnv & SignedIn>, event: AreaEvent): Promise<void> {
  const requestId = c.get('requestId');
  const mapVersion = await bumpMapVersion(c.env, requestId);
  c.executionCtx.waitUntil(fanout(c.env, event, requestId, mapVersion));
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
