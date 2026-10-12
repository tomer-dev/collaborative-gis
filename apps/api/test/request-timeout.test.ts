import { ERROR_CODES, TIMEOUTS } from '@cgis/shared';
import { env } from 'cloudflare:workers';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import pg from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type AppEnv, createApp } from '../src/app';
import { withClient, withSignal } from '../src/db';
import { apiError, httpExceptionError } from '../src/errors';
import { requestTimeout } from '../src/middleware/request-timeout';

/** Outlasts `TIMEOUTS.DB_QUERY_MS`: the database answers only after 5 s. */
const STALLED_QUERY = 'select pg_sleep(5)';
/** A request budget far below `DB_QUERY_MS`, so only the abort can stop the stalled query. */
const SHORT_BUDGET_MS = 300;

afterEach(() => {
  vi.restoreAllMocks();
});

/** The work a test route started, so the test can see how it settled after the response. */
type Started = { work?: Promise<unknown> };

/** `requestTimeout(ms)` in front of a stalled query, with the real app's onError mapping. */
function shortBudgetApp(started: Started) {
  return new Hono<AppEnv>()
    .use(requestTimeout(SHORT_BUDGET_MS))
    .get('/stall', async (c) => {
      started.work = withClient(c.env, (client) => client.query(STALLED_QUERY));
      await started.work;
      return c.text('too late');
    })
    .onError((err, c) =>
      err instanceof HTTPException ? httpExceptionError(c, err) : apiError(c, ERROR_CODES.INTERNAL),
    );
}

describe('request timeout + AbortSignal-aware withClient (2.6)', () => {
  it('a stalled query through the real app answers 504 TIMEOUT within TIMEOUTS.REQUEST_MS and ends its client', async () => {
    const end = vi.spyOn(pg.Client.prototype, 'end');
    const app = createApp();
    app.get('/t/stall', async (c) =>
      c.json(await withClient(c.env, (client) => client.query(STALLED_QUERY))),
    );

    const startedAt = Date.now();
    const res = await app.request('http://x/t/stall', {}, env);

    expect(res.status).toBe(504);
    expect(await res.json()).toEqual({ code: 'TIMEOUT', message: 'timeout' });
    expect(Date.now() - startedAt).toBeLessThan(TIMEOUTS.REQUEST_MS);
    expect(end).toHaveBeenCalled();
  }, 15_000);

  it('when the request budget runs out mid-query, the signal ends the client at once and the request answers 504', async () => {
    const end = vi.spyOn(pg.Client.prototype, 'end');
    const started: Started = {};
    const startedAt = Date.now();
    const res = await shortBudgetApp(started).request('http://x/stall', {}, env);

    expect(res.status).toBe(504);
    expect(await res.json()).toEqual({ code: 'TIMEOUT', message: 'timeout' });
    // The query rejects with the timeout itself, long before pg's own query timeout would fire:
    // the client was ended by the abort, not by the database answering.
    await expect(started.work).rejects.toMatchObject({ status: 504 });
    expect(Date.now() - startedAt).toBeLessThan(TIMEOUTS.DB_QUERY_MS);
    expect(end).toHaveBeenCalled();
  });

  it('withClient(env, fn, { signal }) ends the client when an explicit signal aborts mid-query', async () => {
    const end = vi.spyOn(pg.Client.prototype, 'end');
    const controller = new AbortController();
    const reason = new Error('caller gave up');
    const work = withClient(env, (client) => client.query(STALLED_QUERY), {
      signal: controller.signal,
    });
    const startedAt = Date.now();
    // Mid-query: the connect is local and quick, the query sleeps for seconds.
    setTimeout(() => controller.abort(reason), SHORT_BUDGET_MS);

    await expect(work).rejects.toBe(reason);
    expect(Date.now() - startedAt).toBeLessThan(TIMEOUTS.DB_QUERY_MS);
    expect(end).toHaveBeenCalled();
  });

  it('an already-aborted signal rejects with its reason before connecting', async () => {
    const connect = vi.spyOn(pg.Client.prototype, 'connect');
    const reason = new Error('already gone');
    const fn = vi.fn();

    await expect(withClient(env, fn, { signal: AbortSignal.abort(reason) })).rejects.toBe(reason);
    expect(connect).not.toHaveBeenCalled();
    expect(fn).not.toHaveBeenCalled();
  });

  it('{ signal: null } runs detached from an aborted request signal (background writers)', async () => {
    const gone = AbortSignal.abort(new Error('request over'));
    const rows = await withSignal(gone, () =>
      withClient(env, async (client) => (await client.query('select 1 as one')).rows, {
        signal: null,
      }),
    );
    expect(rows).toEqual([{ one: 1 }]);
  });

  it('a call that finishes in time is unaffected: result returned, client ended once', async () => {
    const end = vi.spyOn(pg.Client.prototype, 'end');
    const rows = await withClient(
      env,
      async (client) => (await client.query('select 1 as one')).rows,
      {
        signal: new AbortController().signal,
      },
    );
    expect(rows).toEqual([{ one: 1 }]);
    expect(end).toHaveBeenCalledOnce();
  });
});
