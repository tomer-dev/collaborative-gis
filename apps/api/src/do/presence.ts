import { type AuthUser, LIMITS, MAP, type PresenceUser, PresenceStateSchema } from '@cgis/shared';
import { z } from 'zod';
import { fullDraftBucket } from './drafts';

/**
 * Per-socket state, kept with `ws.serializeAttachment()` so it survives hibernation. Presence is
 * always derived from these, never from instance memory. With both strings capped, an attachment
 * stays far below the runtime's 16 KiB limit. Zod strips unknown keys, so every stored field is
 * listed here.
 */
export const PresenceAttachmentSchema = z.object({
  userId: z.string().min(1).max(LIMITS.USER_ID_MAX),
  name: z.string().min(1).max(LIMITS.USER_NAME_MAX),
  color: z.enum(MAP.PRESENCE_COLORS),
  state: PresenceStateSchema,
  /** Epoch ms of the last frame the Room handled from this socket (auto-answered pings aside). */
  lastSeen: z.number().int().nonnegative(),
  /** Between `join` and `leave` / close: only joined sockets are in presence and may draft. */
  joined: z.boolean(),
  /** Bad frames so far; at `WS.BAD_FRAME_STRIKES` the socket is closed. */
  strikes: z.number().int().nonnegative(),
  /** The `draft:update` token bucket (`WS.DRAFT_RATE_PER_SEC`), see drafts.ts. */
  tokens: z.number().nonnegative(),
  refilledAt: z.number().int().nonnegative(),
  /** The `seq` of the last accepted `draft:update`; older or repeated frames are dropped. */
  lastSeq: z.number().int().nonnegative().nullable(),
  /**
   * The Room's storage epoch (epoch.ts) at this socket's last `join`; null before its first. A
   * joined socket whose epoch is not the stored one is told to resync.
   */
  epoch: z.uuid().nullable(),
});
export type PresenceAttachment = z.infer<typeof PresenceAttachmentSchema>;
type PresenceColor = PresenceAttachment['color'];

/**
 * The attachment a new socket starts with: `viewing`, not joined, no strikes, a full draft bucket,
 * no accepted `seq` and no epoch (its first `join` sets one).
 */
export async function newAttachment(user: AuthUser, now: number): Promise<PresenceAttachment> {
  return {
    userId: user.id,
    name: user.name,
    color: await presenceColor(user.id),
    state: PresenceStateSchema.enum.viewing,
    lastSeen: now,
    joined: false,
    strikes: 0,
    ...fullDraftBucket(now),
    lastSeq: null,
    epoch: null,
  };
}

/** The attachment `Room` stored on `ws`, or `undefined` when it is missing or invalid. */
export function attachmentOf(ws: WebSocket): PresenceAttachment | undefined {
  const parsed = PresenceAttachmentSchema.safeParse(ws.deserializeAttachment());
  return parsed.success ? parsed.data : undefined;
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

/**
 * The presence list, derived from the attachments of the open, joined sockets: one entry per
 * user, `drawing` if any of that user's sockets is, sorted by name then userId (the runtime's
 * `getWebSockets()` order is not connection order, so the list is sorted to stay stable).
 */
export function presenceOf(attachments: Iterable<PresenceAttachment>): PresenceUser[] {
  const users = new Map<string, PresenceUser>();
  for (const { userId, name, color, state, joined } of attachments) {
    if (!joined) continue;
    const drawing = users.get(userId)?.state === PresenceStateSchema.enum.drawing;
    users.set(userId, {
      userId,
      name,
      color,
      state: drawing ? PresenceStateSchema.enum.drawing : state,
    });
  }
  return [...users.values()].sort(
    (x, y) => x.name.localeCompare(y.name) || x.userId.localeCompare(y.userId),
  );
}
