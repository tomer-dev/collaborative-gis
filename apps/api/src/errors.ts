import { type ApiError, type ApiErrorCode, ERROR_MESSAGES } from '@cgis/shared';
import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
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
  // WebSocket only (an `error` frame); listed after CONFLICT, which keeps 409 in CODE_BY_STATUS.
  DRAFT_OP_MISFIT: 409,
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
 * defaults to `ERROR_MESSAGES[code]`. Generic in `code`, so the response is typed with that one
 * status (`404` for `NOT_FOUND`) and Hono's `hc` client tells error bodies from success bodies by
 * `status`.
 */
export function apiError<C extends ApiErrorCode>(
  c: Context,
  code: C,
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

// A status shared by two codes maps to the one listed first (reversed: the first set wins).
const CODE_BY_STATUS = new Map<number, string>(
  Object.entries(STATUS_BY_CODE)
    .reverse()
    .map(([code, status]) => [status, code]),
);

/**
 * What a blown time budget throws (the request deadline, a stalled query): `app.onError` answers it
 * as 504 `{ code: 'TIMEOUT', message: ERROR_MESSAGES.TIMEOUT }`, without logging it as a crash.
 */
export function timeoutException(cause?: unknown): HTTPException {
  return new HTTPException(STATUS_BY_CODE.TIMEOUT, { message: ERROR_MESSAGES.TIMEOUT, cause });
}

/**
 * A thrown `HTTPException` keeps its status and message; its code comes from the table above, or
 * is `HTTP_<status>` for a status without one.
 */
export function httpExceptionError(c: Context, err: HTTPException) {
  const code = CODE_BY_STATUS.get(err.status) ?? `HTTP_${err.status}`;
  return c.json(errorBody(code, err.message), err.status);
}
