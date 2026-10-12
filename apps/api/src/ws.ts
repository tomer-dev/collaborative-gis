import { DEV, ROOM } from '@cgis/shared';
import type { Context, Handler } from 'hono';
import type { AppEnv } from './app';
import { unauthorizedError, upgradeRequiredError } from './errors';

export type WsUser = NonNullable<AppEnv['Variables']['user']>;

/**
 * Test and local stand-in for a session: `x-debug-user: <id>:<name>`, honoured only when
 * `env.DEBUG_STUB_AUTH === DEV.STUB_AUTH_ON` (vitest.config.ts sets it; wrangler.jsonc keeps it off).
 */
export function stubUserFromHeader(c: Context<AppEnv>): WsUser | undefined {
  if (c.env.DEBUG_STUB_AUTH !== DEV.STUB_AUTH_ON) return undefined;
  const raw = c.req.header(DEV.STUB_AUTH_HEADER);
  if (!raw) return undefined;
  const at = raw.indexOf(DEV.STUB_AUTH_SEPARATOR);
  if (at <= 0) return undefined; // no separator, or an empty id
  const name = raw.slice(at + DEV.STUB_AUTH_SEPARATOR.length);
  return name ? { id: raw.slice(0, at), name } : undefined;
}

/**
 * Serves `GET /ws`: 426 without `Upgrade: websocket`, 401 without a user (session first, then the
 * debug header), else hands the upgrade to the single `Room` with the user in trusted headers.
 */
export const wsUpgrade: Handler<AppEnv> = async (c) => {
  if (c.req.header('upgrade')?.toLowerCase() !== 'websocket') return upgradeRequiredError(c);
  const user = c.get('user') ?? stubUserFromHeader(c);
  if (!user) return unauthorizedError(c);

  // set() replaces any client-sent copies, so the Room only ever sees the authenticated user.
  const headers = new Headers(c.req.raw.headers);
  headers.set(ROOM.USER_ID_HEADER, user.id);
  headers.set(ROOM.USER_NAME_HEADER, encodeURIComponent(user.name));
  const room = c.env.ROOM.get(c.env.ROOM.idFromName(ROOM.DEFAULT_ROOM_ID));
  return room.fetch(new Request(c.req.raw, { headers }));
};
