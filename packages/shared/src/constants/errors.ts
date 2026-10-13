/** Every `ApiError.code` the API sends; apps/api/src/errors.ts maps each to its HTTP status. */
export const ERROR_CODES = {
  /** Malformed request. */
  BAD_REQUEST: 'BAD_REQUEST',
  /** No session. */
  UNAUTHORIZED: 'UNAUTHORIZED',
  /**
   * Foreign or missing Origin on `GET /ws`; not for edit rights (D12: any signed-in user edits).
   */
  FORBIDDEN: 'FORBIDDEN',
  /** Unknown route or area. */
  NOT_FOUND: 'NOT_FOUND',
  /** Optimistic concurrency. */
  CONFLICT: 'CONFLICT',
  /** Validation. */
  UNPROCESSABLE: 'UNPROCESSABLE',
  /** Body limit. */
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  /** D13 rate limits. */
  RATE_LIMITED: 'RATE_LIMITED',
  /** Request budget exceeded. */
  TIMEOUT: 'TIMEOUT',
  /** DB unreachable. */
  NOT_READY: 'NOT_READY',
  /** Sanitised server error. */
  INTERNAL: 'INTERNAL',
  /** Mounted route whose lane has not landed. */
  NOT_IMPLEMENTED: 'NOT_IMPLEMENTED',
  /** `/ws` only speaks WebSocket. */
  UPGRADE_REQUIRED: 'UPGRADE_REQUIRED',
  /**
   * WebSocket only: a `draft:update` op does not fit the Room's copy of the sender's draft (the
   * two diverged), so it is not relayed; the client clears its draft and sends it again.
   */
  DRAFT_OP_MISFIT: 'DRAFT_OP_MISFIT',
} as const;

/** Default `ApiError.message` per code (clients and tests match on them); same keys as ERROR_CODES. */
export const ERROR_MESSAGES = {
  /** Generic 400. */
  BAD_REQUEST: 'Bad request',
  /** 401 body clients match. */
  UNAUTHORIZED: 'sign in',
  /** Generic 403. */
  FORBIDDEN: 'Forbidden',
  /** Stable 404 body. */
  NOT_FOUND: 'Not found',
  /** Generic 409. */
  CONFLICT: 'Conflict',
  /** Generic 422. */
  UNPROCESSABLE: 'Unprocessable',
  /** Generic 413. */
  PAYLOAD_TOO_LARGE: 'Payload too large',
  /** Generic 429. */
  RATE_LIMITED: 'Too many requests',
  /** 504 body. */
  TIMEOUT: 'timeout',
  /** `/readyz` 503 body. */
  NOT_READY: 'database unreachable',
  /** 5xx bodies never leak `err.message`. */
  INTERNAL: 'Internal Server Error',
  /** 501 until the lane fills the stub. */
  NOT_IMPLEMENTED: 'not implemented',
  /** 426 body. */
  UPGRADE_REQUIRED: 'websocket upgrade required',
  /** `error` frame text for a draft op the Room's copy cannot take. */
  DRAFT_OP_MISFIT: 'draft op does not fit the current draft',
} as const satisfies Record<keyof typeof ERROR_CODES, string>;

/** `ApiError.message`s more specific than their code's default in ERROR_MESSAGES. */
export const ERROR_REASONS = {
  /**
   * Cross-site WebSocket hijacking: Better Auth's `getSession` ignores Origin, so without this a
   * foreign page could open a socket with the victim's cookie.
   */
  ORIGIN_NOT_ALLOWED: 'origin not allowed',
  /** 422: PostGIS `ST_IsValid` rejected a polygon Zod accepted; `details.reason` says why. */
  INVALID_GEOMETRY: 'invalid geometry',
  /** 409: the area's stored `version` is not the one the client edited; `details.current` is. */
  VERSION_CONFLICT: 'version conflict',
  /** 422 on sign-up: the trimmed name is longer than `LIMITS.USER_NAME_MAX`. */
  NAME_TOO_LONG: 'name too long',
} as const;

/**
 * `error` frame messages the Room sends where ERROR_MESSAGES' per-code default says too little.
 * Clients branch on the code, never on these texts.
 */
export const WS_MESSAGES = {
  /** Says what the Room accepts; a schema failure sends Zod's issue text instead. */
  NOT_JSON: 'frames must be JSON text',
  /** Drafts come only from users in presence. */
  NOT_JOINED: 'send join first',
} as const;
