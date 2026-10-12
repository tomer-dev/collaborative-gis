import { type AuthUser, LIMITS, ROOM } from '@cgis/shared';
import { z } from 'zod';

/**
 * The Worker → Room hand-off. `wsUpgrade` authenticates and writes the user into two headers;
 * the Room trusts them because only this Worker holds the `ROOM` binding, and validates them
 * anyway. Both sides of that contract live here.
 */

/** True for `Upgrade: websocket` (the token is case-insensitive, RFC 6455 §4.2.1). */
export function isWebSocketUpgrade(request: Request): boolean {
  return request.headers.get('upgrade')?.toLowerCase() === 'websocket';
}

/** A copy of `request` that carries `user`; `set` replaces any copies the client sent. */
export function withRoomUser(request: Request, user: AuthUser): Request {
  const headers = new Headers(request.headers);
  headers.set(ROOM.USER_ID_HEADER, user.id);
  // Header values cannot carry non-Latin-1 text, so the name travels percent-encoded.
  headers.set(ROOM.USER_NAME_HEADER, encodeURIComponent(user.name));
  return new Request(request, { headers });
}

const percentDecoded = z.string().transform((value, ctx) => {
  try {
    return decodeURIComponent(value);
  } catch {
    ctx.addIssue({ code: 'custom', message: 'not percent-encoded' });
    return z.NEVER;
  }
});

/** Cuts at a code-point boundary, so the cap never splits a surrogate pair. */
function capName(name: string): string {
  let capped = '';
  for (const char of name) {
    if (capped.length + char.length > LIMITS.USER_NAME_MAX) break;
    capped += char;
  }
  return capped;
}

const RoomUserHeadersSchema = z.object({
  id: z.string().min(1).max(LIMITS.USER_ID_MAX),
  name: percentDecoded.pipe(z.string().trim().min(1)).transform(capName),
});

/** The user `withRoomUser` wrote, validated: non-empty id, name decoded, trimmed and capped. */
export function readRoomUser(request: Request) {
  return RoomUserHeadersSchema.safeParse({
    id: request.headers.get(ROOM.USER_ID_HEADER),
    name: request.headers.get(ROOM.USER_NAME_HEADER),
  });
}
