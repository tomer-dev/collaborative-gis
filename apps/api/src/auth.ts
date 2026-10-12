import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { betterAuth } from 'better-auth/minimal';
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
 */
export function createAuth(env: Env, client: pg.Client) {
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
  withClient(c.env, (client) => createAuth(c.env, client).handler(c.req.raw));

/**
 * The user of the session in `headers` (only the Cookie header matters), or null. Without a
 * cookie there is no session to look up, so the database is not touched.
 */
export async function getSessionUser(env: Env, headers: Headers): Promise<SessionUser | null> {
  if (!headers.has('cookie')) return null;
  return withClient(env, async (client) => {
    const session = await createAuth(env, client).api.getSession({ headers });
    return session ? { id: session.user.id, name: session.user.name } : null;
  });
}
