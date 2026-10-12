import { type ApiError, type ApiErrorCode, ERROR_CODES, ERROR_MESSAGES } from '@cgis/shared';
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
export type ErrorCode = ApiErrorCode;

function send(
  c: Context,
  status: ContentfulStatusCode,
  code: string,
  message: string,
  details?: unknown,
) {
  const body: ApiError = details === undefined ? { code, message } : { code, message, details };
  return c.json(body, status);
}

/** Responds with `{ code, message, details? }` and the status that belongs to `code`. */
export function apiError(c: Context, code: ErrorCode, message: string, details?: unknown) {
  return send(c, STATUS_BY_CODE[code], code, message, details);
}

/** A helper for one code; the message defaults to `ERROR_MESSAGES[code]`. */
const errorFor =
  (code: ErrorCode) =>
  (c: Context, message: string = ERROR_MESSAGES[code], details?: unknown) =>
    apiError(c, code, message, details);

export const badRequestError = errorFor(ERROR_CODES.BAD_REQUEST);
export const unauthorizedError = errorFor(ERROR_CODES.UNAUTHORIZED);
export const forbiddenError = errorFor(ERROR_CODES.FORBIDDEN);
export const notFoundError = errorFor(ERROR_CODES.NOT_FOUND);
export const conflictError = errorFor(ERROR_CODES.CONFLICT);
export const payloadTooLargeError = errorFor(ERROR_CODES.PAYLOAD_TOO_LARGE);
export const unprocessableError = errorFor(ERROR_CODES.UNPROCESSABLE);
export const upgradeRequiredError = errorFor(ERROR_CODES.UPGRADE_REQUIRED);
export const rateLimitedError = errorFor(ERROR_CODES.RATE_LIMITED);
export const internalError = errorFor(ERROR_CODES.INTERNAL);
export const notImplementedError = errorFor(ERROR_CODES.NOT_IMPLEMENTED);
export const notReadyError = errorFor(ERROR_CODES.NOT_READY);
export const timeoutError = errorFor(ERROR_CODES.TIMEOUT);

const CODE_BY_STATUS = new Map<number, string>(
  Object.entries(STATUS_BY_CODE).map(([code, status]) => [status, code]),
);

/** The `ApiError.code` for an HTTP status: the table above, else `HTTP_<status>`. */
export function codeFor(status: number): string {
  return CODE_BY_STATUS.get(status) ?? `HTTP_${status}`;
}

/** A thrown `HTTPException` keeps its status and message. */
export function httpExceptionError(c: Context, err: HTTPException) {
  return send(c, err.status, codeFor(err.status), err.message);
}
