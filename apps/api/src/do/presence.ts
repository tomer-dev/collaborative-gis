import { MAP, type PresenceState } from '@cgis/shared';

/**
 * Per-socket state, kept with `ws.serializeAttachment()` (≤ 16 KiB) so it survives hibernation.
 * Presence is always derived from these, never from instance memory. T7 adds its own fields.
 */
export type PresenceAttachment = {
  userId: string;
  name: string;
  color: PresenceColor;
  state: PresenceState;
  lastSeen: number;
};

export type PresenceColor = (typeof MAP.PRESENCE_COLORS)[number];

/** The attachment `Room` stored when it accepted `ws`. */
export function attachmentOf(ws: WebSocket): PresenceAttachment {
  return ws.deserializeAttachment() as PresenceAttachment;
}

/**
 * A colour from `MAP.PRESENCE_COLORS`, picked by the SHA-256 of `userId`, so one user keeps one
 * colour across sockets, reconnects and hibernation without storing it.
 */
export async function presenceColor(userId: string): Promise<PresenceColor> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(userId));
  // 2^32 is a multiple of the palette size (8), so the modulo is unbiased.
  const index = new DataView(digest).getUint32(0) % MAP.PRESENCE_COLORS.length;
  return MAP.PRESENCE_COLORS[index] ?? MAP.PRESENCE_COLORS[0];
}
