import { ROOM } from '@cgis/shared';
import type { Handler } from 'hono';
import type { AppEnv } from './app';
import { isWebSocketUpgrade, withRoomUser } from './do/handoff';
import { unauthorizedError, upgradeRequiredError } from './errors';

/**
 * Serves `GET /ws`: 426 without `Upgrade: websocket`, 401 without a session user, else hands the
 * upgrade to the single `Room` with the user in its trusted headers. Authentication is not done
 * here: the session middleware sets `c.get('user')`, and tests inject it at the composition layer.
 */
export const wsUpgrade: Handler<AppEnv> = async (c) => {
  if (!isWebSocketUpgrade(c.req.raw)) return upgradeRequiredError(c);
  const user = c.get('user');
  if (!user) return unauthorizedError(c);
  const room = c.env.ROOM.get(c.env.ROOM.idFromName(ROOM.DEFAULT_ROOM_ID));
  return room.fetch(withRoomUser(c.req.raw, user));
};
