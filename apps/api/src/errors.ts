import type { ApiError } from '@cgis/shared';
import type { Context } from 'hono';
import type { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

/** Every `ApiError.code` the API sends, and the HTTP status that goes with it. */
const STATUS_BY_CODE = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  UNPROCESSABLE: 422,
  RATE_LIMITED: 429,
  INTERNAL: 500,
  NOT_READY: 503,
  TIMEOUT: 504,
} as const satisfies Record<string, ContentfulStatusCode>;
export type ErrorCode = keyof typeof STATUS_BY_CODE;

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

const errorFor =
  (code: ErrorCode, defaultMessage: string) =>
  (c: Context, message: string = defaultMessage, details?: unknown) =>
    apiError(c, code, message, details);

export const badRequestError = errorFor('BAD_REQUEST', 'Bad request');
export const unauthorizedError = errorFor('UNAUTHORIZED', 'Unauthorized');
export const forbiddenError = errorFor('FORBIDDEN', 'Forbidden');
export const notFoundError = errorFor('NOT_FOUND', 'Not found');
export const conflictError = errorFor('CONFLICT', 'Conflict');
export const payloadTooLargeError = errorFor('PAYLOAD_TOO_LARGE', 'Payload too large');
export const unprocessableError = errorFor('UNPROCESSABLE', 'Unprocessable');
export const rateLimitedError = errorFor('RATE_LIMITED', 'Too many requests');
export const internalError = errorFor('INTERNAL', 'Internal Server Error');
export const notReadyError = errorFor('NOT_READY', 'Not ready');
export const timeoutError = errorFor('TIMEOUT', 'Timed out');

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
