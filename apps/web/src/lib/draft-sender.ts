import { applyDraftOp, type DraftOp, type Position, WS } from '@cgis/shared';

const MS_PER_SECOND = 1000;
/** Spacing between `draft:update` frames: exactly the Room's per-socket budget. */
export const DRAFT_INTERVAL_MS = MS_PER_SECOND / WS.DRAFT_RATE_PER_SEC;

const CLEAR: DraftOp = { op: 'clear' };

const same = (a: Position | undefined, b: Position | undefined) =>
  a !== undefined && b !== undefined && a[0] === b[0] && a[1] === b[1];

/**
 * The one op that takes the Room's copy (`sent`) a step toward the draw tool's (`target`), or
 * null when they match. Past the common prefix and suffix, a pure insertion is an `add`, a pure
 * deletion a `remove`, anything else a `move` at the first difference; an empty target is
 * `clear`. A click is one `add`, a vertex drag one `move` (the draw tool reports it at drag end),
 * an undo one `remove`.
 */
export function nextDraftOp(
  sent: readonly Position[],
  target: readonly Position[],
): DraftOp | null {
  if (target.length === 0) return sent.length > 0 ? CLEAR : null;
  const shorter = Math.min(sent.length, target.length);
  let prefix = 0;
  while (prefix < shorter && same(sent[prefix], target[prefix])) prefix++;
  if (prefix === sent.length && prefix === target.length) return null;
  let suffix = 0;
  while (
    suffix < shorter - prefix &&
    same(sent[sent.length - 1 - suffix], target[target.length - 1 - suffix])
  ) {
    suffix++;
  }
  const vertex = target[prefix];
  if (vertex === undefined || (target.length < sent.length && prefix + suffix === target.length)) {
    return { op: 'remove', index: prefix };
  }
  if (target.length > sent.length && prefix + suffix === sent.length) {
    return { op: 'add', index: prefix, vertex };
  }
  return { op: 'move', index: prefix, vertex };
}

/** The last op sent: its frame's `seq`, and the sender's state before it, to take it back. */
type LastOp = { seq: number; sent: Position[]; mustClear: boolean };

/**
 * Streams the signed-in user's draft to the Room as single-op `draft:update`s, one every
 * `DRAFT_INTERVAL_MS` at most (the first at once). Ops are computed when sent, from what the Room
 * has (`sent`) to the latest vertices, so a burst of draw events collapses into the ops still
 * needed. `restart()` is for when the Room's copy is unknown: it sends `clear`, then the whole
 * draft again.
 */
export class DraftSender {
  private sent: Position[] = [];
  private target: Position[] = [];
  private mustClear = false;
  private last: LastOp | undefined;
  private lastSentAt = -Infinity;
  private resumeAt = -Infinity;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;
  private readonly send: (op: DraftOp) => number | null;
  private readonly canSend: () => boolean;

  /**
   * `send` returns the frame's `seq`, or null when it was dropped; nothing is sent while
   * `canSend()` is false.
   */
  constructor(send: (op: DraftOp) => number | null, canSend: () => boolean) {
    this.send = send;
    this.canSend = canSend;
  }

  /** The draw tool's current vertices; `[]` ends the draft (one `clear`). */
  update(vertices: Position[]): void {
    this.target = vertices;
    this.pump();
  }

  /** The Room's copy is unknown (a new socket, an `error` with `resync`): clear it, send all again. */
  restart(): void {
    this.mustClear = this.sent.length > 0 || this.target.length > 0;
    this.sent = [];
    this.last = undefined;
    this.pump();
  }

  /**
   * `RATE_LIMITED` on the frame `frameSeq`: send nothing for `ms`. The Room refused that op before
   * applying it, so when it is the last op sent, taking it back leaves `sent` exact and the ops
   * still needed (that one first) go out once the pause ends. When ops were sent after it (built
   * on it) or no frame is named, the Room's copy is unknown: the draft restarts.
   */
  pause(ms: number, frameSeq?: number): void {
    this.resumeAt = Date.now() + ms;
    const last = this.last;
    if (last === undefined || frameSeq !== last.seq) {
      this.restart();
      return;
    }
    this.sent = last.sent;
    this.mustClear = last.mustClear;
    this.last = undefined;
    this.pump();
  }

  dispose(): void {
    this.disposed = true;
    clearTimeout(this.timer);
  }

  private pump(): void {
    if (this.disposed || this.timer !== undefined || !this.canSend()) return;
    const op = this.mustClear ? CLEAR : nextDraftOp(this.sent, this.target);
    const next = op && applyDraftOp(this.sent, op);
    if (!op || !next) return;
    const wait = Math.max(this.lastSentAt + DRAFT_INTERVAL_MS, this.resumeAt) - Date.now();
    if (wait > 0) {
      this.timer = setTimeout(() => {
        this.timer = undefined;
        this.pump();
      }, wait);
      return;
    }
    const seq = this.send(op);
    if (seq === null) return;
    this.last = { seq, sent: this.sent, mustClear: this.mustClear };
    this.lastSentAt = Date.now();
    this.mustClear = false;
    this.sent = next;
    this.pump();
  }
}
