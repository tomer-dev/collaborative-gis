import { ERROR_REASONS, HEADERS, ROOM } from '@cgis/shared';
import type { MiddlewareHandler } from 'hono';
import { every } from 'hono/combine';
import type { AppEnv } from './app';
import { isWebSocketUpgrade, withRoomUser } from './do/handoff';
import { forbiddenError, upgradeRequiredError } from './errors';
import { requireUser } from './middleware/require-user';

/** `new URL(value).origin`, or null for a missing or unparsable value. */
function originOf(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/**
 * The checks between a signed-in request and its socket: 426 UPGRADE_REQUIRED without
 * `Upgrade: websocket`, then 403 FORBIDDEN (`ERROR_REASONS.ORIGIN_NOT_ALLOWED`) unless the
 * Origin header, normalised, equals `env.CLIENT_ORIGIN`. Better Auth's `getSession` ignores
 * Origin, so this is what stops another site's page from opening a socket with a visitor's
 * cookie. Browsers always send Origin on a WebSocket upgrade, so a missing one is refused too.
 */
export function wsGate(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (!isWebSocketUpgrade(c.req.raw)) return upgradeRequiredError(c);
    const origin = originOf(c.req.header(HEADERS.ORIGIN));
    if (!origin || origin !== originOf(c.env.CLIENT_ORIGIN)) {
      return forbiddenError(c, ERROR_REASONS.ORIGIN_NOT_ALLOWED);
    }
    await next();
  };
}

/**
 * Hands the upgrade to the single `Room` with the user in its trusted headers. It runs only
 * after `requireUser()`, so a missing user here is a wiring bug: it throws (a logged 500) and
 * nothing reaches the Room.
 */
const roomHandoff: MiddlewareHandler<AppEnv> = async (c) => {
  const user = c.get('user');
  if (!user) throw new Error('GET /ws reached the Room hand-off without a session user');
  const room = c.env.ROOM.get(c.env.ROOM.idFromName(ROOM.DEFAULT_ROOM_ID));
  return room.fetch(withRoomUser(c.req.raw, user));
};

/**
 * Serves `GET /ws`. Each step answers or passes on, in this order, so the session is resolved
 * before any 101:
 * 1. `requireUser()`: 401 UNAUTHORIZED without a session (`attachUser()` in the chain reads it).
 * 2. `wsGate()`: 426 UPGRADE_REQUIRED, then 403 FORBIDDEN for a foreign or missing Origin.
 * 3. The Room hand-off: the Room's 101 and the client end of the socket.
 */
export const wsUpgrade: MiddlewareHandler<AppEnv> = every(requireUser(), wsGate(), roomHandoff);
