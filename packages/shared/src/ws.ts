import { z } from 'zod';
import { AreaSchema } from './area';
import { PositionSchema } from './geo';

const base = { seq: z.number().int().nonnegative(), ts: z.number().int().nonnegative() };

export const PresenceUserSchema = z.object({
  userId: z.string(),
  name: z.string(),
  color: z.string().regex(/^#[0-9a-f]{6}$/i),
  state: z.enum(['viewing', 'drawing']),
});
export type PresenceUser = z.infer<typeof PresenceUserSchema>;

export const WsEnvelopeSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('join'), ...base, payload: z.object({ mapId: z.string() }) }),
  z.object({ type: z.literal('leave'), ...base, payload: z.object({}) }),
  z.object({
    type: z.literal('presence'),
    ...base,
    payload: z.object({ users: z.array(PresenceUserSchema) }),
  }),
  z.object({
    type: z.literal('draft:update'),
    ...base,
    payload: z.discriminatedUnion('op', [
      z.object({
        op: z.literal('add'),
        index: z.number().int().nonnegative(),
        vertex: PositionSchema,
      }),
      z.object({
        op: z.literal('move'),
        index: z.number().int().nonnegative(),
        vertex: PositionSchema,
      }),
      z.object({ op: z.literal('remove'), index: z.number().int().nonnegative() }),
      z.object({ op: z.literal('clear') }),
    ]),
  }),
  z.object({ type: z.literal('area:created'), ...base, payload: z.object({ area: AreaSchema }) }),
  z.object({ type: z.literal('area:updated'), ...base, payload: z.object({ area: AreaSchema }) }),
  z.object({ type: z.literal('area:deleted'), ...base, payload: z.object({ id: z.uuid() }) }),
  z.object({
    type: z.literal('error'),
    ...base,
    payload: z.object({ code: z.string(), message: z.string(), retryAfter: z.number().optional() }),
  }),
]);
export type WsEvent = z.infer<typeof WsEnvelopeSchema>;
export type WsEventType = WsEvent['type'];

export function parseWsMessage(raw: string): WsEvent {
  return WsEnvelopeSchema.parse(JSON.parse(raw));
}
