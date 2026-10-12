import type { Auth } from 'better-auth';
import type { Handler } from 'hono';
import type pg from 'pg';
import type { AppEnv, Env } from './app';
import { db, withClient } from './db';
import * as schema from './db/auth-schema';

/** The signed-in user as handlers see it (`c.get('user')`). */
export type SessionUser = NonNullable<AppEnv['Variables']['user']>;

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
  const [{ betterAuth }, { drizzleAdapter }] = await Promise.all([
    import('better-auth/minimal'),
    import('better-auth/adapters/drizzle'),
  ]);
  return betterAuth({
    // `better-auth/minimal` leaves out Kysely, which only direct database connections need.
    database: drizzleAdapter(db(client), { provider: 'pg', schema }),
    emailAndPassword: { enabled: true },
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

/**
 * The user of the session in `headers` (only the Cookie header matters), or null. Without Better
 * Auth's session cookie (`getSessionCookie` reads its name, `__Secure-` prefix included) there is
 * no session to look up, so the database is not touched: other cookies cost nothing.
 */
export async function getSessionUser(env: Env, headers: Headers): Promise<SessionUser | null> {
  const { getSessionCookie } = await import('better-auth/cookies');
  if (!getSessionCookie(headers)) return null;
  return withClient(env, async (client) => {
    const session = await (await createAuth(env, client)).api.getSession({ headers });
    return session ? { id: session.user.id, name: session.user.name } : null;
  });
}
