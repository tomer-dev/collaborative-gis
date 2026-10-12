import { RATE_LIMIT, ROUTES } from '@cgis/shared';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { Hono } from 'hono';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { type AppEnv, createApp, type Env } from '../../src/app';
import { recordAudit } from '../../src/db/audit';
import { auditAuth, auditRejections } from '../../src/middleware/audit';
import { freshUser, randomSpot, squareAt } from '../areas/fixtures';
import { PASSWORD, withCookies } from '../auth/session';
import { appWithUser, TEST, type User } from '../helpers';
import { auditEnv, auditRowsOf, auditRowsWhere } from './fixtures';

// Wire values (action names, entity types, column names, codes) are spelled out on purpose: they
// are the audit trail's contract.

const IP = '203.0.113.9';
const USER_AGENT = 'audit-test/1.0';

let env: Env;
beforeAll(async () => {
  env = await auditEnv();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * The real app (as `user`, or anonymous) behind the two audit middlewares, mounted on the paths
 * app.ts gives them. Outside the app's own chain here, which changes nothing they read: both act
 * after `next()`, when the request id and the session user are set.
 */
function audited(user?: User) {
  return new Hono<AppEnv>()
    .use(`${ROUTES.AUTH}/*`, auditAuth())
    .use(`${ROUTES.API_PREFIX}/*`, auditRejections())
    .route('/', user ? appWithUser(user) : createApp());
}

/** One request with an ExecutionContext, as the runtime gives one, awaited until `waitUntil` settles. */
async function send(app: Hono<AppEnv>, path: string, init: RequestInit, bindings: Env = env) {
  const headers = new Headers(init.headers);
  headers.set('cf-connecting-ip', IP);
  headers.set('user-agent', USER_AGENT);
  const ctx = createExecutionContext();
  const res = await app.request(path, { ...init, headers }, bindings, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

/** A Better Auth call from the SPA's origin. */
function auth(path: string, body?: unknown, headers: Record<string, string> = {}) {
  return send(audited(), `${env.BETTER_AUTH_URL}${ROUTES.AUTH}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { origin: env.CLIENT_ORIGIN, 'content-type': 'application/json', ...headers },
    body: body === undefined ? null : JSON.stringify(body),
  });
}

async function signUp() {
  const email = `audit-${crypto.randomUUID()}@example.com`;
  const res = await auth('/sign-up/email', { email, password: PASSWORD, name: 'Audit Tester' });
  expect(res.status).toBe(200);
  const { user } = await res.clone().json<{ user: { id: string } }>();
  return { res, email, userId: user.id, cookie: withCookies(res) };
}

/** `POST /api/areas` as `user` through the audited app. */
function createArea(user: User | undefined, body: unknown, bindings: Env = env) {
  return send(
    audited(user),
    ROUTES.AREAS,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
    bindings,
  );
}

const requestIdOf = (res: Response) => res.headers.get('x-request-id');

describe('auditAuth', () => {
  it('a sign-in writes auth.sign_in with the user, ip, user agent and request id', async () => {
    const { email, userId } = await signUp();

    const res = await auth('/sign-in/email', { email, password: PASSWORD });

    expect(res.status).toBe(200);
    expect(await auditRowsOf(env, res)).toEqual([
      {
        user_id: userId,
        action: 'auth.sign_in',
        entity: 'user',
        entity_id: userId,
        version: null,
        ip: IP,
        user_agent: USER_AGENT,
        request_id: requestIdOf(res),
        details: null,
      },
    ]);
  });

  it('a wrong password writes auth.sign_in_failed with a null user and the reason code', async () => {
    const { email } = await signUp();

    const res = await auth('/sign-in/email', { email, password: 'not the password' });

    expect(res.status).toBe(401);
    expect(await auditRowsOf(env, res)).toEqual([
      {
        user_id: null,
        action: 'auth.sign_in_failed',
        entity: 'user',
        entity_id: null,
        version: null,
        ip: IP,
        user_agent: USER_AGENT,
        request_id: requestIdOf(res),
        details: { status: 401, code: 'INVALID_EMAIL_OR_PASSWORD' },
      },
    ]);
  });

  it('sign-up and sign-out write auth.sign_up and auth.sign_out for that user', async () => {
    const { res, userId, cookie } = await signUp();
    expect(await auditRowsOf(env, res)).toEqual([
      expect.objectContaining({
        user_id: userId,
        action: 'auth.sign_up',
        entity: 'user',
        entity_id: userId,
      }),
    ]);

    const out = await auth('/sign-out', {}, { cookie });

    expect(out.status).toBe(200);
    expect(await auditRowsOf(env, out)).toEqual([
      expect.objectContaining({
        user_id: userId,
        action: 'auth.sign_out',
        entity: 'user',
        entity_id: userId,
      }),
    ]);
  });

  it('other auth endpoints write nothing', async () => {
    const res = await auth('/get-session');
    expect(res.status).toBe(200);
    expect(await auditRowsOf(env, res)).toEqual([]);
  });
});

describe('auditRejections', () => {
  it('a 422 create writes one request.rejected row with details.code and no entity id', async () => {
    const user = freshUser();

    const res = await createArea(user, { geometry: squareAt(randomSpot()) });

    expect(res.status).toBe(422);
    expect(await auditRowsOf(env, res)).toEqual([
      {
        user_id: user.id,
        action: 'request.rejected',
        entity: 'request',
        entity_id: null,
        version: null,
        ip: IP,
        user_agent: USER_AGENT,
        request_id: requestIdOf(res),
        details: { code: 'UNPROCESSABLE', status: 422, method: 'POST', path: ROUTES.AREAS },
      },
    ]);
  });

  it('a successful create still writes exactly one row: area.create, from the transaction', async () => {
    const user = freshUser();

    const res = await createArea(user, { name: 'Audited', geometry: squareAt(randomSpot()) });

    expect(res.status).toBe(201);
    const { id } = await res.json<{ id: string }>();
    expect(await auditRowsWhere(env, 'user_id = $1', [user.id])).toEqual([
      {
        user_id: user.id,
        action: 'area.create',
        entity: 'area',
        entity_id: id,
        version: 1,
        ip: IP,
        user_agent: USER_AGENT,
        request_id: requestIdOf(res),
        details: null,
      },
    ]);
  });

  it(
    'a 429 writes request.rejected with details.code RATE_LIMITED',
    async () => {
      const user = freshUser();
      const limiter = env.RATE_LIMITER.get(env.RATE_LIMITER.idFromName(user.id));
      for (let i = 0; i < RATE_LIMIT.DRAW_ACTIONS_PER_WINDOW; i++) {
        expect((await limiter.take(RATE_LIMIT.ACTIONS.DRAW)).ok).toBe(true);
      }

      const res = await createArea(user, { name: 'Over budget', geometry: squareAt(randomSpot()) });

      expect(res.status).toBe(429);
      expect(await auditRowsOf(env, res)).toEqual([
        expect.objectContaining({
          user_id: user.id,
          action: 'request.rejected',
          entity_id: null,
          details: { code: 'RATE_LIMITED', status: 429, method: 'POST', path: ROUTES.AREAS },
        }),
      ]);
    },
    TEST.SLOW_TIMEOUT_MS,
  );

  it('a response that is neither 422 nor 429 writes nothing (401 here)', async () => {
    const res = await createArea(undefined, { name: 'Anonymous' });
    expect(res.status).toBe(401);
    expect(await auditRowsOf(env, res)).toEqual([]);
  });

  it('a failed audit write leaves the response alone and logs one JSON error line', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const unreachable: Env = {
      ...env,
      HYPERDRIVE: { ...env.HYPERDRIVE, connectionString: 'postgresql://nobody:x@127.0.0.1:1/none' },
    };

    // Validation answers before any query, so only the audit write needs the database.
    const res = await createArea(freshUser(), { geometry: squareAt(randomSpot()) }, unreachable);

    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ code: 'UNPROCESSABLE' });
    expect(logged).toHaveBeenCalledOnce();
    expect(JSON.parse(String(logged.mock.calls[0]?.[0]))).toMatchObject({
      level: 'error',
      msg: 'audit write failed',
      action: 'request.rejected',
      requestId: requestIdOf(res),
    });
  });

  it('answers as usual when the request has no ExecutionContext to wait on', async () => {
    const res = await audited(freshUser()).request(
      ROUTES.AREAS,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
      env,
    );
    expect(res.status).toBe(422);
  });
});

describe('recordAudit', () => {
  it('redacts LOG.REDACT_KEYS in details, any case, any depth', async () => {
    const requestId = crypto.randomUUID();

    await recordAudit(env, {
      action: 'request.rejected',
      entity: 'request',
      requestId,
      details: { code: 'X', password: 'hunter2', nested: { Cookie: 'a=b', kept: 1 } },
    });

    const [row] = await auditRowsWhere(env, 'request_id = $1', [requestId]);
    expect(row?.details).toEqual({
      code: 'X',
      password: '[redacted]',
      nested: { Cookie: '[redacted]', kept: 1 },
    });
  });
});
