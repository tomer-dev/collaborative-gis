import { type ApiError, type ApiErrorCode, ERROR_MESSAGES } from '@cgis/shared';
import type { Context } from 'hono';
import type { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

/**
 * The HTTP status for every `ApiError.code`. Codes and default messages live in
 * `@cgis/shared` constants; `satisfies` fails the build if a code is added there without a status.
 */
const STATUS_BY_CODE = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  UNPROCESSABLE: 422,
  UPGRADE_REQUIRED: 426,
  RATE_LIMITED: 429,
  INTERNAL: 500,
  NOT_IMPLEMENTED: 501,
  NOT_READY: 503,
  TIMEOUT: 504,
} as const satisfies Record<ApiErrorCode, ContentfulStatusCode>;

function errorBody(code: string, message: string, details?: unknown): ApiError {
  return details === undefined ? { code, message } : { code, message, details };
}

/**
 * Responds with `{ code, message, details? }` and the status that belongs to `code`; the message
 * defaults to `ERROR_MESSAGES[code]`.
 */
export function apiError(
  c: Context,
  code: ApiErrorCode,
  message: string = ERROR_MESSAGES[code],
  details?: unknown,
) {
  return c.json(errorBody(code, message, details), STATUS_BY_CODE[code]);
}

/**
 * The same body and status as `apiError`, without a Hono `Context`: for code that answers a plain
 * `fetch` (the Room Durable Object). The message defaults to `ERROR_MESSAGES[code]`.
 */
export function apiErrorResponse(
  code: ApiErrorCode,
  message: string = ERROR_MESSAGES[code],
  details?: unknown,
): Response {
  return Response.json(errorBody(code, message, details), { status: STATUS_BY_CODE[code] });
}

const CODE_BY_STATUS = new Map<number, string>(
  Object.entries(STATUS_BY_CODE).map(([code, status]) => [status, code]),
);

/**
 * A thrown `HTTPException` keeps its status and message; its code comes from the table above, or
 * is `HTTP_<status>` for a status without one.
 */
export function httpExceptionError(c: Context, err: HTTPException) {
  const code = CODE_BY_STATUS.get(err.status) ?? `HTTP_${err.status}`;
  return c.json(errorBody(code, err.message), err.status);
}
