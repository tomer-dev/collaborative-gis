import { RATE_LIMIT } from '@cgis/shared';
import { evictDurableObject, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RateLimiter } from '../../src/do/rate-limiter';

const { DRAW_ACTIONS_PER_WINDOW: LIMIT, WINDOW_MS, ACTIONS } = RATE_LIMIT;
// Far ahead of the real clock: workerd schedules alarms on real time, so an alarm armed at a
// mocked instant in the past would fire at once. Tests run alarms with runDurableObjectAlarm.
const T0 = Date.UTC(2100, 0, 1);

type Limiter = DurableObjectStub<RateLimiter>;

// A fresh user per test: Durable Object state never leaks between tests.
const limiterFor = (userId: string): Limiter =>
  env.RATE_LIMITER.get(env.RATE_LIMITER.idFromName(userId));
const freshLimiter = () => limiterFor(`user-${crypto.randomUUID()}`);

async function takeN(limiter: Limiter, n: number) {
  const results = [];
  for (let i = 0; i < n; i++) results.push(await limiter.take(ACTIONS.DRAW));
  return results;
}

function rows(limiter: Limiter) {
  return runInDurableObject(limiter, (_instance: RateLimiter, state) =>
    state.storage.sql.exec<{ ts: number }>('SELECT ts FROM actions ORDER BY ts').toArray(),
  );
}

function hasActionsTable(limiter: Limiter) {
  return runInDurableObject(limiter, (_instance: RateLimiter, state) => {
    const { n } = state.storage.sql
      .exec<{ n: number }>(
        "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'actions'",
      )
      .one();
    return n === 1;
  });
}

function alarmAt(limiter: Limiter) {
  return runInDurableObject(limiter, (_instance: RateLimiter, state) => state.storage.getAlarm());
}

// vi.setSystemTime mocks Date for the whole isolate, and the vitest plugin runs the
// Durable Objects of the main Worker in the test isolate, so the DO sees the same clock.
beforeEach(() => {
  vi.setSystemTime(T0);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('RateLimiter: exact sliding window per user (D5)', () => {
  it('allows DRAW_ACTIONS_PER_WINDOW actions, counting remaining down to 0', async () => {
    const results = await takeN(freshLimiter(), LIMIT);
    expect(results).toEqual(
      Array.from({ length: LIMIT }, (_, i) => ({ ok: true, remaining: LIMIT - 1 - i })),
    );
  });

  it('rejects the next action with retryAfterMs in (0, WINDOW_MS]', async () => {
    const limiter = freshLimiter();
    await takeN(limiter, LIMIT);

    const result = await limiter.take(ACTIONS.DRAW);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.retryAfterMs).toBeGreaterThan(0);
    expect(result.retryAfterMs).toBeLessThanOrEqual(WINDOW_MS);
    // All actions happened at T0, so the oldest leaves the window a full window later.
    expect(result.retryAfterMs).toBe(WINDOW_MS);
  });

  it('retryAfterMs is the exact wait until the oldest action leaves the window', async () => {
    const limiter = freshLimiter();
    await takeN(limiter, LIMIT);

    vi.setSystemTime(T0 + 20_500);
    expect(await limiter.take(ACTIONS.DRAW)).toEqual({
      ok: false,
      retryAfterMs: WINDOW_MS - 20_500,
    });
  });

  it('refills exactly as old actions leave the window (sliding, not fixed)', async () => {
    const limiter = freshLimiter();
    const half = LIMIT / 2;
    await takeN(limiter, half);
    vi.setSystemTime(T0 + 10_000);
    await takeN(limiter, LIMIT - half);

    // One millisecond before the first batch leaves the window: still full.
    vi.setSystemTime(T0 + WINDOW_MS - 1);
    expect(await limiter.take(ACTIONS.DRAW)).toEqual({ ok: false, retryAfterMs: 1 });

    // The first batch has left; the second batch (10 s later) still counts.
    vi.setSystemTime(T0 + WINDOW_MS);
    const refilled = await takeN(limiter, half);
    expect(refilled.every((r) => r.ok)).toBe(true);
    expect(refilled.at(-1)).toEqual({ ok: true, remaining: 0 });
    expect(await limiter.take(ACTIONS.DRAW)).toEqual({ ok: false, retryAfterMs: 10_000 });
  });

  it('rejected attempts do not consume budget', async () => {
    const limiter = freshLimiter();
    await takeN(limiter, LIMIT);
    vi.setSystemTime(T0 + 30_000);
    const rejected = await takeN(limiter, 20);
    expect(rejected.every((r) => !r.ok)).toBe(true);

    vi.setSystemTime(T0 + WINDOW_MS);
    expect(await limiter.take(ACTIONS.DRAW)).toEqual({ ok: true, remaining: LIMIT - 1 });
  });

  it('concurrent calls never overspend the budget', async () => {
    const limiter = freshLimiter();
    const results = await Promise.all(
      Array.from({ length: LIMIT + 10 }, () => limiter.take(ACTIONS.DRAW)),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(LIMIT);
    expect(await rows(limiter)).toHaveLength(LIMIT);
  });

  it('gives each user an independent budget', async () => {
    const alice = freshLimiter();
    const bob = freshLimiter();
    await takeN(alice, LIMIT);

    expect((await alice.take(ACTIONS.DRAW)).ok).toBe(false);
    expect(await bob.take(ACTIONS.DRAW)).toEqual({ ok: true, remaining: LIMIT - 1 });
  });

  it('keeps the window across eviction (state lives in storage, not memory)', async () => {
    const limiter = freshLimiter();
    await takeN(limiter, LIMIT - 1);

    await evictDurableObject(limiter);
    expect(await limiter.take(ACTIONS.DRAW)).toEqual({ ok: true, remaining: 0 });
    await evictDurableObject(limiter);
    expect(await limiter.take(ACTIONS.DRAW)).toEqual({ ok: false, retryAfterMs: WINDOW_MS });
  });

  it('never stores more than DRAW_ACTIONS_PER_WINDOW rows, all inside the window', async () => {
    const limiter = freshLimiter();
    for (let w = 0; w < 3; w++) {
      const now = T0 + w * WINDOW_MS;
      vi.setSystemTime(now);
      await takeN(limiter, LIMIT + 10);

      const stored = await rows(limiter);
      expect(stored).toHaveLength(LIMIT);
      expect(stored.every(({ ts }) => ts > now - WINDOW_MS)).toBe(true);
    }
  });

  it('arms an alarm once the window holds actions', async () => {
    const limiter = freshLimiter();
    expect(await alarmAt(limiter)).toBeNull();

    await limiter.take(ACTIONS.DRAW);
    expect(await alarmAt(limiter)).toBe(T0 + WINDOW_MS);
  });

  it('the alarm deletes all storage once the user has been idle for a whole window', async () => {
    const limiter = freshLimiter();
    await takeN(limiter, 3);

    vi.setSystemTime(T0 + WINDOW_MS);
    expect(await runDurableObjectAlarm(limiter)).toBe(true);
    expect(await hasActionsTable(limiter)).toBe(false);
    expect(await alarmAt(limiter)).toBeNull();

    // The limiter recreates its table on the next action, with a full budget.
    expect(await limiter.take(ACTIONS.DRAW)).toEqual({ ok: true, remaining: LIMIT - 1 });
    expect(await alarmAt(limiter)).toBe(T0 + 2 * WINDOW_MS);
  });

  it('an alarm while actions remain keeps them and re-arms for the newest', async () => {
    const limiter = freshLimiter();
    await limiter.take(ACTIONS.DRAW);
    vi.setSystemTime(T0 + 30_000);
    await limiter.take(ACTIONS.DRAW);

    vi.setSystemTime(T0 + WINDOW_MS);
    expect(await runDurableObjectAlarm(limiter)).toBe(true);
    expect(await rows(limiter)).toEqual([{ ts: T0 + 30_000 }]);
    expect(await alarmAt(limiter)).toBe(T0 + 30_000 + WINDOW_MS);
  });
});

describe('RateLimiter: input safety', () => {
  it('binds the action as a value: a hostile string is stored verbatim, the table survives', async () => {
    const limiter = freshLimiter();
    await limiter.take(ACTIONS.DRAW);
    const hostile = "'); DROP TABLE actions; --";

    // take() now rejects anything outside RATE_LIMIT.ACTIONS, so run the INSERT that take()
    // runs, in the DO, with the hostile string as its bound parameter.
    const stored = await runInDurableObject(limiter, (_instance: RateLimiter, state) => {
      state.storage.sql.exec('INSERT INTO actions (ts, action) VALUES (?, ?)', Date.now(), hostile);
      return state.storage.sql
        .exec<{ action: string }>('SELECT action FROM actions ORDER BY rowid')
        .toArray();
    });

    expect(await hasActionsTable(limiter)).toBe(true);
    expect(stored).toEqual([{ action: ACTIONS.DRAW }, { action: hostile }]);
  });

  it('rejects an action outside RATE_LIMIT.ACTIONS, logging only its length', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const limiter = freshLimiter();
    const unknown = 'not-an-action';

    // The one `as never`: it stands in for an untyped RPC caller, which the TS signature cannot stop.
    // The async wrapper hands vitest a native promise: `expect(rpcPromise).rejects` passed but left
    // the RPC rejection unhandled, which vitest reports as an error and fails the run.
    const call = async () => limiter.take(unknown as never);
    await expect(call()).rejects.toThrow('unknown rate limit action');

    expect(warn).toHaveBeenCalledOnce();
    const logged = String(warn.mock.calls[0]?.[0]);
    expect(JSON.parse(logged)).toMatchObject({ length: unknown.length });
    expect(logged).not.toContain(unknown);
    // Nothing was spent.
    expect(await limiter.take(ACTIONS.DRAW)).toEqual({ ok: true, remaining: LIMIT - 1 });
  });
});
