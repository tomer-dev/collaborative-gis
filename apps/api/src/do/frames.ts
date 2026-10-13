import {
  type DraftOp,
  WS_MESSAGES,
  type WsClientEvent,
  WsClientEventSchema,
  type WsEvent,
} from '@cgis/shared';
import { z } from 'zod';

/** The status of a WebSocket upgrade response (RFC 6455). Close codes are the shared `WS.CLOSE_*`. */
export const SWITCHING_PROTOCOLS = 101;

type Unstamped<E> = E extends unknown ? Omit<E, 'seq' | 'ts'> : never;
/** A server event before it is stamped: `seq` comes from storage, `ts` from the clock. */
export type RoomEvent = Unstamped<WsEvent>;

/**
 * A `draft:update` as relayed to the other sockets: the sender's op with `userId` always set to the
 * sender (receivers pick the ghost polygon by it). The shared schema has it optional because
 * clients may omit it; any value a client sent is overwritten.
 */
export type DraftRelay = { type: 'draft:update'; payload: DraftOp & { userId: string } };

/** A client frame parsed with `WsClientEventSchema`, or the `error` message to answer it with. */
export function parseClientFrame(
  message: string | ArrayBuffer,
): { success: true; event: WsClientEvent } | { success: false; message: string } {
  if (typeof message !== 'string') return { success: false, message: WS_MESSAGES.NOT_JSON };
  let json: unknown;
  try {
    json = JSON.parse(message);
  } catch {
    return { success: false, message: WS_MESSAGES.NOT_JSON };
  }
  const parsed = WsClientEventSchema.safeParse(json);
  return parsed.success
    ? { success: true, event: parsed.data }
    : { success: false, message: z.prettifyError(parsed.error) };
}
