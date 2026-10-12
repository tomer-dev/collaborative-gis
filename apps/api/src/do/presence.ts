import { LIMITS, MAP, PresenceStateSchema } from '@cgis/shared';
import { z } from 'zod';

/**
 * Per-socket state, kept with `ws.serializeAttachment()` so it survives hibernation. Presence is
 * always derived from these, never from instance memory. With both strings capped, an attachment
 * stays far below the runtime's 16 KiB limit. T7 extends this schema with its own fields.
 */
export const PresenceAttachmentSchema = z.object({
  userId: z.string().min(1).max(LIMITS.USER_ID_MAX),
  name: z.string().min(1).max(LIMITS.USER_NAME_MAX),
  color: z.enum(MAP.PRESENCE_COLORS),
  state: PresenceStateSchema,
  lastSeen: z.number().int().nonnegative(),
});
export type PresenceAttachment = z.infer<typeof PresenceAttachmentSchema>;
export type PresenceColor = PresenceAttachment['color'];

/** The attachment `Room` stored on `ws`, or `undefined` when it is missing or invalid. */
export function attachmentOf(ws: WebSocket): PresenceAttachment | undefined {
  const parsed = PresenceAttachmentSchema.safeParse(ws.deserializeAttachment());
  return parsed.success ? parsed.data : undefined;
}

/**
 * A colour from `MAP.PRESENCE_COLORS`, picked by the SHA-256 of `userId`, so one user keeps one
 * colour across sockets, reconnects and hibernation without any stored assignment.
 */
export async function presenceColor(userId: string): Promise<PresenceColor> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(userId));
  // 2^32 is a multiple of the palette size (8), so the modulo is unbiased.
  const index = new DataView(digest).getUint32(0) % MAP.PRESENCE_COLORS.length;
  return MAP.PRESENCE_COLORS[index] ?? MAP.PRESENCE_COLORS[0];
}
