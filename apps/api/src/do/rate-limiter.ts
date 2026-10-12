import { RATE_LIMIT, type RateLimitAction } from '@cgis/shared';
import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../app';
import { log } from '../log';

const { DRAW_ACTIONS_PER_WINDOW: LIMIT, WINDOW_MS } = RATE_LIMIT;
const KNOWN_ACTIONS: ReadonlySet<unknown> = new Set(Object.values(RATE_LIMIT.ACTIONS));

/** One `take`: the budget left after it, or how long until an action leaves the window. */
export type TakeResult = { ok: true; remaining: number } | { ok: false; retryAfterMs: number };

/**
 * Exact sliding-window limiter for one user (`idFromName(userId)`), D5: at most
 * DRAW_ACTIONS_PER_WINDOW accepted actions in any WINDOW_MS span, one budget shared by REST
 * mutations (the `rateLimit` middleware) and WS drawing actions (the Room DO calls `take`).
 *
 * The window lives only in SQLite, so hibernation or eviction cannot reset it. Exact is cheap
 * here: `actions` holds just the accepted actions still inside the window (never more than the
 * limit), and every call prunes the rest first.
 */
export class RateLimiter extends DurableObject<Env> {
  /**
   * Records the action if the window has room; otherwise says when the oldest one leaves it.
   * Throws on an action outside RATE_LIMIT.ACTIONS: RPC does not enforce the TS type.
   */
  async take(action: RateLimitAction): Promise<TakeResult> {
    if (!KNOWN_ACTIONS.has(action)) {
      // Caller-controlled value: log its length, never the value itself.
      const length = typeof action === 'string' ? action.length : null;
      log('warn', 'unknown rate limit action', { length });
      throw new Error('unknown rate limit action');
    }

    const now = Date.now();
    const sql = this.#prune(now);
    const { count } = sql.exec<{ count: number }>('SELECT COUNT(*) AS count FROM actions').one();

    if (count >= LIMIT) {
      // A slot frees when the oldest action leaves the window, at oldest + WINDOW_MS. The cap
      // keeps the contract (0, WINDOW_MS] if the clock ever steps back past a stored action.
      const { oldest } = sql
        .exec<{ oldest: number }>('SELECT MIN(ts) AS oldest FROM actions')
        .one();
      return { ok: false, retryAfterMs: Math.min(oldest + WINDOW_MS - now, WINDOW_MS) };
    }

    // No await between the count and this insert, so concurrent calls cannot overspend.
    sql.exec('INSERT INTO actions (ts, action) VALUES (?, ?)', now, action);
    // One pending alarm per object; it re-arms itself while actions remain (see alarm()).
    if ((await this.ctx.storage.getAlarm()) === null) {
      await this.ctx.storage.setAlarm(now + WINDOW_MS);
    }
    return { ok: true, remaining: LIMIT - count - 1 };
  }

  /**
   * Prunes expired actions and re-arms for the newest one left. Once the user has been idle
   * for a whole window, deletes all storage (and, from compatibility date 2026-02-24, the
   * alarm) so idle users leave nothing behind.
   */
  async alarm(): Promise<void> {
    const sql = this.#prune(Date.now());
    const { newest } = sql
      .exec<{ newest: number | null }>('SELECT MAX(ts) AS newest FROM actions')
      .one();
    if (newest === null) await this.ctx.storage.deleteAll();
    else await this.ctx.storage.setAlarm(newest + WINDOW_MS);
  }

  /** Creates `actions` if missing (deleteAll drops it) and deletes the actions outside the window. */
  #prune(now: number): SqlStorage {
    const sql = this.ctx.storage.sql;
    sql.exec('CREATE TABLE IF NOT EXISTS actions (ts INTEGER NOT NULL, action TEXT NOT NULL)');
    sql.exec('DELETE FROM actions WHERE ts <= ?', now - WINDOW_MS);
    return sql;
  }
}
