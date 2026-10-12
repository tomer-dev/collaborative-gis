import { AUTH, type AuthUser, ERROR_REASONS, LIMITS } from '@cgis/shared';
import type { Auth } from 'better-auth';
import type { Handler } from 'hono';
import type pg from 'pg';
import type { AppEnv, Env } from './app';
import { db, withClient } from './db';
import * as schema from './db/auth-schema';

/**
 * Better Auth bound to one request's `pg.Client` (from `withClient`). Built per request, never at
 * module scope: workerd cancels a request that waits on I/O opened by another request. Init costs
 * well under a millisecond (M1 spike).
 *
 * Better Auth is imported on first use rather than with this module, so code that never
 * authenticates (Durable Objects, /healthz, and every workerd test isolate that loads the Worker)
 * does not evaluate it; it is about half of the Worker bundle. Typed as the two members callers
 * use: the inferred type names Better Auth internals, which the emitted declarations cannot.
 */
export async function createAuth(
  env: Env,
  client: pg.Client,
): Promise<Pick<Auth, 'handler' | 'api'>> {
  const [{ betterAuth }, { drizzleAdapter }, { APIError }] = await Promise.all([
    import('better-auth/minimal'),
    import('better-auth/adapters/drizzle'),
    import('better-auth/api'),
  ]);
  return betterAuth({
    // `better-auth/minimal` leaves out Kysely, which only direct database connections need.
    database: drizzleAdapter(db(client), { provider: 'pg', schema }),
    emailAndPassword: { enabled: true },
    // D24: a signed `session_data` cookie answers session checks for this long without a database
    // read. Same-device sign-out clears it at once; a session revoked elsewhere lags up to maxAge.
    session: { cookieCache: { enabled: true, maxAge: AUTH.COOKIE_CACHE_MAX_AGE_S } },
    databaseHooks: {
      user: {
        create: {
          // Better Auth's sign-up takes a name of any length; the header, presence list and ghost
          // labels show it, and get-session returns it on every check. Trimmed and capped here.
          before: async (user) => {
            const name = user.name.trim();
            if (name.length > LIMITS.USER_NAME_MAX) {
              throw new APIError('UNPROCESSABLE_ENTITY', { message: ERROR_REASONS.NAME_TOO_LONG });
            }
            return { data: { ...user, name } };
          },
        },
      },
    },
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    // The SPA's origin; Better Auth also trusts its own baseURL.
    trustedOrigins: [env.CLIENT_ORIGIN],
    advanced: {
      // Cloudflare's edge sets the client IP here; without it sessions store an empty ipAddress.
      ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] },
      // Explicit: Better Auth turns both checks off when process.env has NODE_ENV=test or TEST,
      // and nodejs_compat fills process.env from the Worker's vars.
      disableCSRFCheck: false,
      disableOriginCheck: false,
    },
  });
}

/** Serves `/api/auth/*`: hands the raw request to Better Auth on a per-request client. */
export const authHandler: Handler<AppEnv> = (c) =>
  withClient(c.env, async (client) => (await createAuth(c.env, client)).handler(c.req.raw));

/** One session check: the user (null without a session) and the cookies Better Auth set doing it. */
export type SessionRead = { user: AuthUser | null; setCookie: string[] };

/**
 * The session in `headers` (only the Cookie header matters). Without Better Auth's session cookie
 * (`getSessionCookie` reads its name, `__Secure-` prefix included) there is no session to look
 * up, so the database is not touched: other cookies cost nothing. A valid cookie cache (D24)
 * answers without reading the session row; when the row is read, Better Auth sets a fresh cache
 * cookie, returned in `setCookie` for the response.
 */
export async function readSession(env: Env, headers: Headers): Promise<SessionRead> {
  const { getSessionCookie } = await import('better-auth/cookies');
  if (!getSessionCookie(headers)) return { user: null, setCookie: [] };
  return withClient(env, async (client) => {
    const auth = await createAuth(env, client);
    const { headers: set, response } = await auth.api.getSession({ headers, returnHeaders: true });
    const user = response ? { id: response.user.id, name: response.user.name } : null;
    return { user, setCookie: set.getSetCookie() };
  });
}
