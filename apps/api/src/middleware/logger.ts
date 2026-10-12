import { LOG } from '@cgis/shared';
import type { Context } from 'hono';
import type { AppEnv } from '../app';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const REDACT = new RegExp(LOG.REDACT_KEYS.join('|'), 'i');

/**
 * A `JSON.stringify` replacer: the value of any key that contains a `LOG.REDACT_KEYS` word (any
 * case, any depth) becomes `LOG.REDACTED`. Shared by the log lines and the audit rows' `details`.
 */
export const redact = (key: string, value: unknown): unknown =>
  REDACT.test(key) ? LOG.REDACTED : value;

/**
 * Writes one JSON line `{ level, msg, requestId, userId?, path, ...extra }` to the console method
 * of `level`, which Workers Logs ingests. Any key that contains a `LOG.REDACT_KEYS` word (any case,
 * any depth in `extra`) has its value replaced by `LOG.REDACTED`.
 */
export function log(
  c: Context<AppEnv>,
  level: LogLevel,
  msg: string,
  extra?: Record<string, unknown>,
): void {
  const entry = {
    level,
    msg,
    requestId: c.get('requestId'),
    userId: c.get('user')?.id,
    path: c.req.path,
    ...extra,
  };
  console[level](JSON.stringify(entry, redact));
}
