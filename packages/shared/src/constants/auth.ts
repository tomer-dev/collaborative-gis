/** Better Auth session settings (D24) and its sign-in rate limit. */
export const AUTH = {
  /**
   * Better Auth's signed session cookie cache, in seconds (D24): within it a request is
   * authenticated from the cookie without a database read, so a session revoked elsewhere stays
   * usable for at most this long.
   */
  COOKIE_CACHE_MAX_AGE_S: 300,
  /**
   * Better Auth path pattern (relative to `ROUTES.AUTH`) the sign-in rate limit covers. On only
   * under an https `BETTER_AUTH_URL` (a deployed Worker).
   */
  RATE_LIMIT_PATH: '/sign-in/*',
  /** Sign-in rate limit window, in seconds; over the limit Better Auth answers 429 `X-Retry-After`. */
  RATE_LIMIT_WINDOW_S: 60,
  /**
   * Sign-in attempts per client IP per window. Counted in each Worker isolate's memory, so it slows
   * one client; the zone's WAF rate rule (docs/deploy.md) is the global cap.
   */
  RATE_LIMIT_MAX: 10,
  /**
   * `localStorage` key the web app sets while this browser holds a session and removes once it
   * holds none. On a cold load it decides whether the app frame shows before the first session
   * check answers (set) or the session status does (unset). Never carries who was signed in.
   */
  SIGNED_IN_HINT_KEY: 'cgis.signedIn',
  /** The only value `SIGNED_IN_HINT_KEY` holds; any other (or none) means nothing remembered. */
  SIGNED_IN_HINT_VALUE: '1',
} as const;
