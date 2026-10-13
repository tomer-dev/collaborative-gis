import { LOG } from '@cgis/shared';
import type { Context } from 'hono';
import type { AppEnv } from './app';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const REDACT = new RegExp(LOG.REDACT_KEYS.join('|'), 'i');

/**
 * A `JSON.stringify` replacer: the value of any key that contains a `LOG.REDACT_KEYS` word (any
 * case, any depth) becomes `LOG.REDACTED`. Shared by `log` and the audit rows' `details`.
 */
export const redact = (key: string, value: unknown): unknown =>
  REDACT.test(key) ? LOG.REDACTED : value;

/**
 * Writes one JSON line `{ level, msg, ...fields }` to the console method of `level`, which
 * Workers Logs ingests. Any key that contains a `LOG.REDACT_KEYS` word (any case, any depth in
 * `fields`) has its value replaced by `LOG.REDACTED`. Request code passes `requestFields(c)`;
 * Durable Objects and background work, which have no Hono context, pass their own fields.
 */
export function log(level: LogLevel, msg: string, fields: Record<string, unknown> = {}): void {
  console[level](JSON.stringify({ level, msg, ...fields }, redact));
}

/** The request's `requestId`, signed-in `userId` and `path`, for `log`. */
export function requestFields(c: Context<AppEnv>) {
  return { requestId: c.get('requestId'), userId: c.get('user')?.id, path: c.req.path };
}
