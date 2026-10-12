/** Better Auth session settings (D24). */
export const AUTH = {
  /**
   * Better Auth's signed session cookie cache, in seconds (D24): within it a request is
   * authenticated from the cookie without a database read, so a session revoked elsewhere stays
   * usable for at most this long.
   */
  COOKIE_CACHE_MAX_AGE_S: 300,
} as const;
