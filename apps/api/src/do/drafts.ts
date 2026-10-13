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

/** A per-socket fixed one-second window, kept in the socket attachment so hibernation keeps it. */
type DraftRate = { windowStart: number; frames: number };

type DraftTake =
  { ok: true; rate: DraftRate } | { ok: false; rate: DraftRate; retryAfterMs: number };

/** A window opening at `now`, nothing counted yet (D13: `WS.DRAFT_RATE_PER_SEC` frames a second). */
export const freshDraftRate = (now: number): DraftRate => ({ windowStart: now, frames: 0 });

/**
 * Counts one frame in `rate`'s window; a frame a second or more after its start (or before it, a
 * clock that stepped back) opens a new one. Past the cap, says how long until the window ends.
 */
export function takeDraftFrame(rate: DraftRate, now: number): DraftTake {
  const open = now >= rate.windowStart && now - rate.windowStart < MS_PER_SECOND;
  const current = open ? rate : freshDraftRate(now);
  if (current.frames < WS.DRAFT_RATE_PER_SEC) {
    return { ok: true, rate: { ...current, frames: current.frames + 1 } };
  }
  return { ok: false, rate: current, retryAfterMs: current.windowStart + MS_PER_SECOND - now };
}

type DraftRow = { user_id: string; vertices: string };

/** The stored `vertices` of an open session with nothing drawn. */
const NO_VERTICES = JSON.stringify([]);

/**
 * In-progress polygons and their draw sessions (D5), one row per user, in the Room's SQLite
 * storage: `drafts(user_id TEXT PRIMARY KEY, vertices TEXT, updated_at INTEGER)`, where `vertices`
 * is the JSON `[lng, lat][]` and `updated_at` the epoch ms of the last op. A row is an open draw
 * session: the `add` that starts a draft writes it, and it stays, with no vertices after a `clear`
 * or the user's departure, until their save (`end`) or the idle sweep (`deleteIdle`) deletes it.
 * Being in SQLite, a session outlives hibernation and eviction. Only rows with vertices are drafts
 * anyone sees (`all`).
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

  /** `userId`'s draft in their open session (`[]` when nothing is drawn); `undefined` with none. */
  vertices(userId: string): Position[] | undefined {
    const [row] = this.sql
      .exec<DraftRow>('SELECT user_id, vertices FROM drafts WHERE user_id = ?', userId)
      .toArray();
    return row && toDraft(row).vertices;
  }

  /** Stores `userId`'s draft as of `now`, opening their session if none is open. */
  write(userId: string, vertices: Position[], now: number): void {
    this.sql.exec(
      `INSERT INTO drafts (user_id, vertices, updated_at) VALUES (?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET vertices = excluded.vertices, updated_at = excluded.updated_at`,
      userId,
      JSON.stringify(vertices),
      now,
    );
  }

  /** Empties `userId`'s draft and keeps their session open; `true` if it had vertices. */
  empty(userId: string): boolean {
    const emptied = this.sql.exec(
      'UPDATE drafts SET vertices = ? WHERE user_id = ? AND vertices <> ? RETURNING user_id',
      NO_VERTICES,
      userId,
      NO_VERTICES,
    );
    return emptied.toArray().length > 0;
  }

  /** Ends `userId`'s session, their draft with it; `true` if the draft had vertices. */
  end(userId: string): boolean {
    return drawn(
      this.sql.exec<Pick<DraftRow, 'vertices'>>(
        'DELETE FROM drafts WHERE user_id = ? RETURNING vertices',
        userId,
      ),
    );
  }

  /**
   * Ends the sessions last edited before `cutoff` (epoch ms), their drafts with them; `true` if
   * any of those drafts had vertices.
   */
  deleteIdle(cutoff: number): boolean {
    return drawn(
      this.sql.exec<Pick<DraftRow, 'vertices'>>(
        'DELETE FROM drafts WHERE updated_at < ? RETURNING vertices',
        cutoff,
      ),
    );
  }

  /** How many sessions are open, drawn or not. */
  count(): number {
    return this.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM drafts').one().n;
  }

  /** Every draft with vertices, oldest edit first. */
  all(): Draft[] {
    return this.sql
      .exec<DraftRow>(
        'SELECT user_id, vertices FROM drafts WHERE vertices <> ? ORDER BY updated_at, user_id',
        NO_VERTICES,
      )
      .toArray()
      .map(toDraft);
  }
}

/** Whether any of the deleted rows had vertices (a draft on screen went with it). */
function drawn(deleted: SqlStorageCursor<Pick<DraftRow, 'vertices'>>): boolean {
  return deleted.toArray().some(({ vertices }) => vertices !== NO_VERTICES);
}

/** Storage is ours, but the JSON is still validated rather than trusted with a cast. */
function toDraft(row: DraftRow): Draft {
  return { userId: row.user_id, vertices: VerticesSchema.parse(JSON.parse(row.vertices)) };
}
