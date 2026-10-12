import { type ApiError, ApiErrorSchema } from '@cgis/shared';

// The one module that knows the HTTP client: swapping native fetch for another library touches only this file.

/** Anything with Zod's `parse` (the `@cgis/shared` schemas), so this app needs no direct zod import. */
export type Parser<T> = { parse(data: unknown): T };

/** A non-2xx API response; `body` is the server's `ApiError` when the response carried one. */
export class ApiRequestError extends Error {
  readonly status: number;
  readonly body: ApiError | null;

  constructor(status: number, body: ApiError | null) {
    super(body?.message ?? `HTTP ${status}`);
    this.name = 'ApiRequestError';
    this.status = status;
    this.body = body;
  }
}

/**
 * GETs a same-origin API path (cookies sent, no cross-origin credentials) and returns the
 * body parsed by `schema`. Rejects with `ApiRequestError` on a non-2xx status, and with the
 * parser's error when a 2xx body is not JSON or does not match.
 */
export async function apiGet<T>(path: `/${string}`, schema: Parser<T>): Promise<T> {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: { accept: 'application/json' },
  });
  return parseResponse(res, schema);
}

/**
 * POSTs `body` as JSON to a same-origin API path; responses are handled exactly as in `apiGet`.
 * The browser adds the same-origin `Origin` header, which Better Auth requires on every POST.
 */
export async function apiPost<T>(path: `/${string}`, body: unknown, schema: Parser<T>): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return parseResponse(res, schema);
}

async function parseResponse<T>(res: Response, schema: Parser<T>): Promise<T> {
  if (!res.ok) {
    const error = ApiErrorSchema.safeParse(await res.json().catch(() => null));
    throw new ApiRequestError(res.status, error.success ? error.data : null);
  }
  return schema.parse(await res.json());
}
