import { ApiErrorSchema, ERROR_CODES, ERROR_MESSAGES, type ApiError } from '@cgis/shared';
import { hc } from 'hono/client';
import { z } from 'zod';
// Type only (erased from the bundle). tsconfig.app.json references the api's declaration project,
// so tsc reads apps/api/dist-types/app.d.ts here, never the Worker's source.
import type { AppType } from '../../../api/src/app';

/**
 * The SPA's one client for its own API (D19): Hono RPC typed from the api's routes, on the page's
 * origin (Vite proxies /api to `wrangler dev`), sending the session cookie. Auth traffic goes
 * through Better Auth's client instead (lib/auth-client.ts).
 */
export const api = hc<AppType>('/', { init: { credentials: 'same-origin' } });

/** What the readers below need from an `hc` response. */
type ApiResponse = { status: number; json(): Promise<unknown> };

const ReasonDetailsSchema = z.object({ reason: z.string() });

/** An API answer with a status the caller did not expect, carrying the parsed `ApiError` body. */
export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;
  /** `details.reason`: why PostGIS rejected a polygon (422), when the server sent one. */
  readonly reason: string | undefined;

  constructor(status: number, { code, message, details }: ApiError) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.reason = ReasonDetailsSchema.safeParse(details).data?.reason;
  }
}

// A body that is not an ApiError (a proxy error page, an empty body) reads as INTERNAL.
async function requestError(res: ApiResponse): Promise<ApiRequestError> {
  const body = ApiErrorSchema.safeParse(await res.json().catch(() => undefined));
  const error = body.success
    ? body.data
    : { code: ERROR_CODES.INTERNAL, message: ERROR_MESSAGES.INTERNAL };
  return new ApiRequestError(res.status, error);
}

/**
 * The body of `res` parsed with `schema` when the status is `expected`; any other status throws an
 * `ApiRequestError`. `hc` already types each status's body (the api's `apiError` is typed per
 * code); the Zod parse is the run-time check at the boundary, which a stale deploy or a proxy page
 * would otherwise slip past.
 */
export async function readBody<T>(
  res: ApiResponse,
  expected: number,
  schema: z.ZodType<T>,
): Promise<T> {
  if (res.status !== expected) throw await requestError(res);
  return schema.parse(await res.json());
}

/** A request the API refused for want of a session (`UNAUTHORIZED`): the session ended elsewhere. */
export function isUnauthorized(error: unknown): boolean {
  return error instanceof ApiRequestError && error.code === ERROR_CODES.UNAUTHORIZED;
}

/** Resolves when `res` has the `expected` status (a body-less 204); otherwise throws `ApiRequestError`. */
export async function expectStatus(res: ApiResponse, expected: number): Promise<void> {
  if (res.status !== expected) throw await requestError(res);
}
