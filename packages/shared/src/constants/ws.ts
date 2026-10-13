const PING_INTERVAL_MS = 30_000;

/** Realtime room behaviour, server and client (D13). */
export const WS = {
  /**
   * D13: drafts ≤ 10 msg/s, enforced per socket (a token bucket in the Room). The burst guard on
   * draft frames, which spend no drawing actions: D5 charges a draft session once.
   */
  DRAFT_RATE_PER_SEC: 10,
  /** D13: a draft not edited for 60 s is dropped by the Room's idle sweep; D5: its session ends. */
  PRESENCE_IDLE_MS: 60_000,
  /**
   * The idle sweep closes a socket with no frame and no ping for this long (`CLOSE_IDLE`): three
   * ping intervals, so a hidden tab whose timers the browser throttles to one per minute stays.
   */
  SOCKET_IDLE_MS: 3 * PING_INTERVAL_MS,
  /** Sweeps idle state twice per idle window. */
  ALARM_INTERVAL_MS: 30_000,
  /** Tolerates a few bad frames, stops a flood. */
  BAD_FRAME_STRIKES: 10,
  /** RFC 6455 "policy violation". */
  CLOSE_POLICY_VIOLATION: 1008,
  /** RFC 6455 "internal error": the server cannot attribute the socket. */
  CLOSE_INTERNAL_ERROR: 1011,
  /**
   * RFC 6455 "going away": a client that pings every `PING_INTERVAL_MS` is never reaped; one that
   * stopped is dead, and reconnects if it is not.
   */
  CLOSE_IDLE: 1001,
  /**
   * Client keep-alive, well inside `SOCKET_IDLE_MS`, so a live tab is never swept; keeps proxies
   * alive.
   */
  PING_INTERVAL_MS,
  /** The runtime answers without waking a hibernated Room. */
  AUTO_PING: 'ping',
  AUTO_PONG: 'pong',
  /** Fast first retry, bounded worst case. */
  RECONNECT_BACKOFF_MS: { min: 1000, max: 30_000 },
  /** Degraded mode still converges. */
  OFFLINE_POLL_MS: 10_000,
  /** Client reconnect: each backoff delay is shortened by a random share up to this fraction. */
  CLIENT_BACKOFF_JITTER: 0.5,
  /** Client: consecutive failed connects before the state is `degraded` (reconnecting banner). */
  CLIENT_DEGRADED_AFTER: 2,
  /** Client: consecutive failed connects before the state is `offline` (areas polled instead). */
  CLIENT_OFFLINE_AFTER: 5,
} as const;

/** The single shared map (D11). */
export const ROOM = {
  /** D11: one shared map, one Room DO. */
  DEFAULT_ROOM_ID: 'default',
  /** The Worker hands the session user to the Room; client-sent copies are overwritten. */
  USER_ID_HEADER: 'x-user-id',
  USER_NAME_HEADER: 'x-user-name',
} as const;
