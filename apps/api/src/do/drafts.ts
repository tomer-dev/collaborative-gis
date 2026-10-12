import {
  type Draft,
  DraftSchema,
  LIMITS,
  type Position,
  WS,
  type WsClientEvent,
} from '@cgis/shared';

/** The `payload` of a client `draft:update`: one edit to the sender's in-progress polygon. */
export type DraftOp = Extract<WsClientEvent, { type: 'draft:update' }>['payload'];

const VerticesSchema = DraftSchema.shape.vertices;
const MS_PER_SECOND = 1000;

/**
 * `vertices` after `op`, or `undefined` when the op does not fit them: an index past the end, or
 * an `add` beyond `LIMITS.POLYGON_MAX_VERTICES`. `add` inserts at `index` (`index === length`
 * appends), `move` replaces, `remove` deletes, `clear` empties.
 */
export function applyDraftOp(vertices: Position[], op: DraftOp): Position[] | undefined {
  switch (op.op) {
    case 'add':
      if (op.index > vertices.length || vertices.length >= LIMITS.POLYGON_MAX_VERTICES) {
        return undefined;
      }
      return [...vertices.slice(0, op.index), op.vertex, ...vertices.slice(op.index)];
    case 'move':
      if (op.index >= vertices.length) return undefined;
      return vertices.map((vertex, i) => (i === op.index ? op.vertex : vertex));
    case 'remove':
      if (op.index >= vertices.length) return undefined;
      return vertices.filter((_, i) => i !== op.index);
    case 'clear':
      return [];
  }
}

/** A per-socket token bucket, kept in the socket attachment so hibernation cannot refill it. */
type DraftBucket = { tokens: number; refilledAt: number };

type DraftTake =
  { ok: true; bucket: DraftBucket } | { ok: false; bucket: DraftBucket; retryAfterMs: number };

/** A full bucket: a burst of `WS.DRAFT_RATE_PER_SEC` frames, then that many per second (D13). */
export function fullDraftBucket(now: number): DraftBucket {
  return { tokens: WS.DRAFT_RATE_PER_SEC, refilledAt: now };
}

/**
 * Refills `bucket` for the time since `refilledAt` and spends one token. Without a whole token,
 * says how long until one has accrued.
 */
export function takeDraftToken(bucket: DraftBucket, now: number): DraftTake {
  const rate = WS.DRAFT_RATE_PER_SEC;
  // Math.max: a clock that steps back must not drain the bucket.
  const elapsed = Math.max(0, now - bucket.refilledAt);
  const tokens = Math.min(rate, bucket.tokens + (elapsed * rate) / MS_PER_SECOND);
  if (tokens >= 1) return { ok: true, bucket: { tokens: tokens - 1, refilledAt: now } };
  return {
    ok: false,
    bucket: { tokens, refilledAt: now },
    retryAfterMs: Math.ceil(((1 - tokens) * MS_PER_SECOND) / rate),
  };
}

type DraftRow = { user_id: string; vertices: string };

/**
 * In-progress polygons, one per user, in the Room's SQLite storage:
 * `drafts(user_id TEXT PRIMARY KEY, vertices TEXT, updated_at INTEGER)`, where `vertices` is the
 * JSON `[lng, lat][]` and `updated_at` the epoch ms of the last op. A draft with no vertices is
 * deleted rather than stored.
 */
export class DraftStore {
  constructor(private readonly sql: SqlStorage) {
    sql.exec(
      `CREATE TABLE IF NOT EXISTS drafts (
        user_id TEXT PRIMARY KEY,
        vertices TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
    );
  }

  /** Applies `op` to `userId`'s draft; `false` (and nothing written) when the op does not fit. */
  apply(userId: string, op: DraftOp, now: number): boolean {
    const row = this.sql
      .exec<DraftRow>('SELECT user_id, vertices FROM drafts WHERE user_id = ?', userId)
      .toArray()[0];
    const next = applyDraftOp(row ? toDraft(row).vertices : [], op);
    if (next === undefined) return false;
    if (next.length === 0) {
      this.delete(userId);
      return true;
    }
    this.sql.exec(
      `INSERT INTO drafts (user_id, vertices, updated_at) VALUES (?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET vertices = excluded.vertices, updated_at = excluded.updated_at`,
      userId,
      JSON.stringify(next),
      now,
    );
    return true;
  }

  /** Deletes `userId`'s draft; `true` if there was one. */
  delete(userId: string): boolean {
    return (
      this.sql.exec('DELETE FROM drafts WHERE user_id = ? RETURNING user_id', userId).toArray()
        .length > 0
    );
  }

  /** Deletes drafts last edited before `cutoff` (epoch ms); `true` if any were deleted. */
  deleteIdle(cutoff: number): boolean {
    return (
      this.sql.exec('DELETE FROM drafts WHERE updated_at < ? RETURNING user_id', cutoff).toArray()
        .length > 0
    );
  }

  /** How many drafts are stored. */
  count(): number {
    return this.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM drafts').one().n;
  }

  /** Every stored draft, oldest edit first. */
  all(): Draft[] {
    return this.sql
      .exec<DraftRow>('SELECT user_id, vertices FROM drafts ORDER BY updated_at, user_id')
      .toArray()
      .map(toDraft);
  }
}

/** Storage is ours, but the JSON is still validated rather than trusted with a cast. */
function toDraft(row: DraftRow): Draft {
  return { userId: row.user_id, vertices: VerticesSchema.parse(JSON.parse(row.vertices)) };
}
