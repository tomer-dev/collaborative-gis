import type { WsEvent } from '@cgis/shared';
import type { Env } from '../app';

type AreaEventType = 'area:created' | 'area:updated' | 'area:deleted';

/**
 * An area change for the Room's sockets: a server-sent `WsEvent` without `seq`/`ts`, which the
 * Room stamps when it broadcasts (each socket has its own sequence).
 */
export type AreaEvent = WsEvent extends infer E
  ? E extends { type: AreaEventType }
    ? Omit<E, 'seq' | 'ts'>
    : never
  : never;

/**
 * Broadcasts a committed area change to everyone in the Room. No-op until T8 (TOM-37) forwards it
 * to `env.ROOM`; the routes already call it through `c.executionCtx.waitUntil`, after the commit,
 * so the response never waits on the broadcast.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function fanout(env: Env, event: AreaEvent): Promise<void> {}
