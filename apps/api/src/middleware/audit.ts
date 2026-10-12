import { AUDIT, HEADERS } from '@cgis/shared';
import type { Context, MiddlewareHandler } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../app';
import { readSession } from '../auth';
import { type AuditEvent, recordAudit } from '../db/audit';
import { codeFor } from '../errors';
import { log, requestFields } from '../log';

// D20 rows for what happens around the routes rather than in them: auth events, read from Better
// Auth's answers, and rejected requests (422, 429). Both look at the finished response, write on
// their own client in `waitUntil`, and never change or fail the response. One row per request: a
// failed sign-in is `auth.sign_in_failed` only, never also `request.rejected`. app.ts mounts them
// after the cross-cutting chain and before the routes:
//   app.use(`${ROUTES.AUTH}/*`, auditAuth());
//   app.use(`${ROUTES.API_PREFIX}/*`, auditRejections());

type AuthKey = 'AUTH_SIGN_IN' | 'AUTH_SIGN_UP' | 'AUTH_SIGN_OUT' | 'AUTH_SIGN_IN_FAILED';
type AuthAction = (typeof AUDIT.ACTIONS)[AuthKey];

const REJECTED = new Set<string>(AUDIT.CAPTURE.REJECTED_CODES);

/** Better Auth's sign-in and sign-up answer `{ user, ... }`; errors (ours and its) `{ code, ... }`. */
const UserBodySchema = z.object({ user: z.object({ id: z.string() }) });
const CodeBodySchema = z.object({ code: z.string() });

/** The auth event an answer to `path` records (`ok`: a 2xx status), or null for anything else. */
function authAction(path: string, ok: boolean): AuthAction | null {
  switch (path) {
    case AUDIT.CAPTURE.SIGN_IN_PATH:
      return ok ? AUDIT.ACTIONS.AUTH_SIGN_IN : AUDIT.ACTIONS.AUTH_SIGN_IN_FAILED;
    case AUDIT.CAPTURE.SIGN_UP_PATH:
      return ok ? AUDIT.ACTIONS.AUTH_SIGN_UP : null;
    case AUDIT.CAPTURE.SIGN_OUT_PATH:
      return ok ? AUDIT.ACTIONS.AUTH_SIGN_OUT : null;
    default:
      return null;
  }
}

/**
 * Records sign-in, sign-up, sign-out and failed sign-in by path and status. The user comes from
 * the response body (sign-in, sign-up) or, for sign-out, from the session read just before Better
 * Auth ends it (`attachUser` skips `/api/auth/*`; a lookup that fails only leaves the user null).
 * A failed sign-in has no user and keeps the status and Better Auth's error code in `details`.
 */
export function auditAuth(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const signingOut = c.req.path === AUDIT.CAPTURE.SIGN_OUT_PATH;
    const session = signingOut ? await sessionUserId(c) : null;
    await next();
    const { status, ok } = c.res;
    const action = authAction(c.req.path, ok);
    if (!action) return;
    const res = c.res.clone();
    const base = { ...requestFacts(c), action, entity: AUDIT.ENTITIES.USER };
    afterResponse(c, async () => {
      switch (action) {
        case AUDIT.ACTIONS.AUTH_SIGN_IN_FAILED: {
          const code = await codeOf(res);
          return { ...base, userId: null, entityId: null, details: { status, code } };
        }
        case AUDIT.ACTIONS.AUTH_SIGN_OUT:
          return { ...base, userId: session, entityId: session };
        default: {
          const userId = UserBodySchema.safeParse(await bodyOf(res)).data?.user.id ?? null;
          return { ...base, userId, entityId: userId };
        }
      }
    });
  };
}

/**
 * Records every `AUDIT.CAPTURE.REJECTED_CODES` answer (422 validation, 429 rate limit) as
 * `request.rejected`: the signed-in user if any, no entity id, and `details` with the error code,
 * status, method and path.
 */
export function auditRejections(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    await next();
    const { status, ok } = c.res;
    const fallback = codeFor(status);
    const { method, path } = c.req;
    if (!REJECTED.has(fallback) || authAction(path, ok)) return;
    const res = c.res.clone();
    const base = {
      ...requestFacts(c),
      userId: c.get('user')?.id ?? null,
      action: AUDIT.ACTIONS.REQUEST_REJECTED,
      entity: AUDIT.ENTITIES.REQUEST,
      entityId: null,
    };
    afterResponse(c, async () => {
      const code = await codeOf(res, fallback);
      return { ...base, details: { code, status, method, path } };
    });
  };
}

/** The id of the user whose session cookie the request carries; null without one or on error. */
async function sessionUserId(c: Context<AppEnv>): Promise<string | null> {
  try {
    return (await readSession(c.env, c.req.raw.headers)).user?.id ?? null;
  } catch (err) {
    log('error', 'audit session lookup failed', { ...requestFields(c), error: String(err) });
    return null;
  }
}

/** What every request-borne row carries: client IP and user agent (D20) and the request id. */
function requestFacts(c: Context<AppEnv>) {
  return {
    ip: c.req.header(HEADERS.CF_CONNECTING_IP) ?? null,
    userAgent: c.req.header(HEADERS.USER_AGENT) ?? null,
    requestId: c.get('requestId'),
  };
}

/**
 * Builds the row and writes it after the response, in `waitUntil`. A request without an
 * ExecutionContext (`app.request` without one, as some tests call the app) cannot hand the write
 * over, so the write runs unawaited instead: the response is never held or failed for the audit.
 */
function afterResponse(c: Context<AppEnv>, build: () => Promise<AuditEvent>): void {
  const env = c.env;
  const write = build().then((event) => recordAudit(env, event));
  try {
    c.executionCtx.waitUntil(write);
  } catch {
    // Hono throws here only when the request has no ExecutionContext; `write` is already running.
  }
}

/** The JSON body of `res`, or null when it has none. */
function bodyOf(res: Response): Promise<unknown> {
  return res.json().catch(() => null);
}

/** The error `code` in `res`'s body, else `fallback` (the code for its status). */
async function codeOf(res: Response, fallback = codeFor(res.status)): Promise<string> {
  return CodeBodySchema.safeParse(await bodyOf(res)).data?.code ?? fallback;
}
