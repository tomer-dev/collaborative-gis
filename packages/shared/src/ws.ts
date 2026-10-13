import { z } from 'zod';
import { AreaSchema } from './area.ts';
import { LIMITS } from './constants/index.ts';
import { type Position, PositionSchema } from './geo.ts';

const base = { seq: z.number().int().nonnegative(), ts: z.number().int().nonnegative() };

export const PresenceStateSchema = z.enum(['viewing', 'drawing']);
export type PresenceState = z.infer<typeof PresenceStateSchema>;

export const PresenceUserSchema = z.object({
  userId: z.string(),
  name: z.string(),
  color: z.string().regex(/^#[0-9a-f]{6}$/i),
  state: PresenceStateSchema,
});
export type PresenceUser = z.infer<typeof PresenceUserSchema>;

export const DraftSchema = z.object({ userId: z.string(), vertices: z.array(PositionSchema) });
export type Draft = z.infer<typeof DraftSchema>;

// Client → server
const join = z.object({
  type: z.literal('join'),
  ...base,
  payload: z.object({ mapId: z.string() }),
});
const leave = z.object({ type: z.literal('leave'), ...base, payload: z.object({}) });
const presenceSet = z.object({
  type: z.literal('presence:set'),
  ...base,
  payload: z.object({ state: PresenceStateSchema }),
});
// Both directions: the server rebroadcasts a sender's draft:update to the other sockets.
// `userId` is the author: clients may omit it; the Room always stamps it on the frames it relays
// and overwrites any value a client sent.
const draftAuthor = { userId: z.string().max(LIMITS.USER_ID_MAX).optional() };
const draftUpdate = z.object({
  type: z.literal('draft:update'),
  ...base,
  payload: z.discriminatedUnion('op', [
    z.object({
      op: z.enum(['add', 'move']),
      index: z.number().int().nonnegative(),
      vertex: PositionSchema,
      ...draftAuthor,
    }),
    z.object({ op: z.literal('remove'), index: z.number().int().nonnegative(), ...draftAuthor }),
    z.object({ op: z.literal('clear'), ...draftAuthor }),
  ]),
});

/** The `payload` of a `draft:update`: one edit to the sender's in-progress polygon. */
export type DraftOp = z.infer<typeof draftUpdate>['payload'];

/**
 * `vertices` after `op`, or `undefined` when the op does not fit them: an index past the end, or
 * an `add` beyond `LIMITS.POLYGON_MAX_VERTICES`. `add` inserts at `index` (`index === length`
 * appends), `move` replaces, `remove` deletes, `clear` empties. The Room and the client both
 * apply ops with it, so their copies of a draft agree.
 */
export function applyDraftOp(vertices: readonly Position[], op: DraftOp): Position[] | undefined {
  switch (op.op) {
    case 'add':
      if (op.index > vertices.length || vertices.length >= LIMITS.POLYGON_MAX_VERTICES) return;
      return [...vertices.slice(0, op.index), op.vertex, ...vertices.slice(op.index)];
    case 'move':
      if (op.index >= vertices.length) return;
      return vertices.map((vertex, i) => (i === op.index ? op.vertex : vertex));
    case 'remove':
      if (op.index >= vertices.length) return;
      return vertices.filter((_, i) => i !== op.index);
    case 'clear':
      return [];
  }
}

// Server → client
const presence = z.object({
  type: z.literal('presence'),
  ...base,
  payload: z.object({ users: z.array(PresenceUserSchema) }),
});
const draftState = z.object({
  type: z.literal('draft:state'),
  ...base,
  payload: z.object({ drafts: z.array(DraftSchema) }),
});
// `mapVersion` is the map's version after this change: the Room's counter, bumped once per
// committed area change (D6: the M2 viewport cache keys on it). The Room stamps it on every area
// event it sends; it is optional only so that adding it changed no existing producer.
const mapVersion = { mapVersion: z.number().int().nonnegative().optional() };
const areaCreated = z.object({
  type: z.literal('area:created'),
  ...base,
  ...mapVersion,
  payload: z.object({ area: AreaSchema }),
});
const areaUpdated = z.object({
  type: z.literal('area:updated'),
  ...base,
  ...mapVersion,
  payload: z.object({ area: AreaSchema }),
});
const areaDeleted = z.object({
  type: z.literal('area:deleted'),
  ...base,
  ...mapVersion,
  payload: z.object({ id: z.uuid() }),
});
const error = z.object({
  type: z.literal('error'),
  ...base,
  // retryAfter is in milliseconds (RATE_LIMITED: wait at least this long before retrying).
  // resync: the Room no longer has what the client relies on (its state was lost, the sender's
  // draft diverged or was dropped, or the frame failed inside the Room). The frame was dropped;
  // the client joins again and resends its draft as `clear` + `add`s. Optional (additive).
  // frameSeq: the `seq` of the client frame this answers (RATE_LIMITED on a `draft:update`: the
  // Room refused that op before applying it, so the client can take it back and send it again).
  payload: z.object({
    code: z.string(),
    message: z.string(),
    retryAfter: z.number().optional(),
    resync: z.boolean().optional(),
    frameSeq: z.number().int().optional(),
  }),
});

export const WsEnvelopeSchema = z.discriminatedUnion('type', [
  join,
  leave,
  presenceSet,
  draftUpdate,
  presence,
  draftState,
  areaCreated,
  areaUpdated,
  areaDeleted,
  error,
]);
export type WsEvent = z.infer<typeof WsEnvelopeSchema>;
export type WsEventType = WsEvent['type'];

/** The events a browser may send; the Room rejects anything else. */
export const WsClientEventSchema = z.discriminatedUnion('type', [
  join,
  leave,
  draftUpdate,
  presenceSet,
]);
export type WsClientEvent = z.infer<typeof WsClientEventSchema>;

/**
 * A committed area change as the Worker hands it to the Room (`fanout` → `Room.broadcast` RPC):
 * an `area:*` event before the Room stamps `seq`, `ts` and `mapVersion`. Parsing drops any stamps
 * the caller sent, so the Room's own always win.
 */
export const AreaEventSchema = z.discriminatedUnion('type', [
  areaCreated.omit({ seq: true, ts: true, mapVersion: true }),
  areaUpdated.omit({ seq: true, ts: true, mapVersion: true }),
  areaDeleted.omit({ seq: true, ts: true, mapVersion: true }),
]);
export type AreaEvent = z.infer<typeof AreaEventSchema>;

export function parseWsMessage(raw: string): WsEvent {
  return WsEnvelopeSchema.parse(JSON.parse(raw));
}

export function parseWsClientMessage(raw: string): WsClientEvent {
  return WsClientEventSchema.parse(JSON.parse(raw));
}
