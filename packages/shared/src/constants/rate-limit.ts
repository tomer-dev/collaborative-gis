/** Per-user budget shared by REST mutations and WS drawing actions (D5): an exact sliding window. */
export const RATE_LIMIT = {
  /** D5: 50 drawing actions per user per window, one budget for REST and WS. */
  DRAW_ACTIONS_PER_WINDOW: 50,
  /** D5: exact sliding window over the last 60 s; the 429 `Retry-After` is at most this long. */
  WINDOW_MS: 60_000,
  /**
   * The only labels `RateLimiter.take` accepts. REST mutations and WS draft actions both spend
   * `DRAW`: one drawing-action budget (spec: `requireUser` then `take('draw')`).
   */
  ACTIONS: { DRAW: 'draw' },
} as const;

export type RateLimitAction = (typeof RATE_LIMIT.ACTIONS)[keyof typeof RATE_LIMIT.ACTIONS];
