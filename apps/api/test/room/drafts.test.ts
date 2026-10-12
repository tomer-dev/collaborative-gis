import { LIMITS, type Position, WS } from '@cgis/shared';
import { describe, expect, it } from 'vitest';
import { applyDraftOp, fullDraftBucket, takeDraftToken } from '../../src/do/drafts';

const A: Position = [34.8, 32.0];
const B: Position = [34.9, 32.0];
const C: Position = [34.9, 32.1];

describe('applyDraftOp', () => {
  it('adds at an index (index === length appends), moves, removes and clears', () => {
    expect(applyDraftOp([], { op: 'add', index: 0, vertex: A })).toEqual([A]);
    expect(applyDraftOp([A], { op: 'add', index: 1, vertex: C })).toEqual([A, C]);
    expect(applyDraftOp([A, C], { op: 'add', index: 1, vertex: B })).toEqual([A, B, C]);
    expect(applyDraftOp([A, B], { op: 'move', index: 1, vertex: C })).toEqual([A, C]);
    expect(applyDraftOp([A, B, C], { op: 'remove', index: 1 })).toEqual([A, C]);
    expect(applyDraftOp([A, B], { op: 'clear' })).toEqual([]);
  });

  it('rejects an index past the end', () => {
    expect(applyDraftOp([A], { op: 'add', index: 2, vertex: B })).toBeUndefined();
    expect(applyDraftOp([A], { op: 'move', index: 1, vertex: B })).toBeUndefined();
    expect(applyDraftOp([], { op: 'remove', index: 0 })).toBeUndefined();
  });

  it(`rejects an add beyond LIMITS.POLYGON_MAX_VERTICES (${LIMITS.POLYGON_MAX_VERTICES})`, () => {
    const full: Position[] = Array.from({ length: LIMITS.POLYGON_MAX_VERTICES }, () => A);
    expect(applyDraftOp(full, { op: 'add', index: 0, vertex: B })).toBeUndefined();
    expect(applyDraftOp(full.slice(1), { op: 'add', index: 0, vertex: B })).toHaveLength(
      LIMITS.POLYGON_MAX_VERTICES,
    );
  });
});

describe('takeDraftToken', () => {
  const t0 = 1_700_000_000_000;

  it(`allows a burst of WS.DRAFT_RATE_PER_SEC (${WS.DRAFT_RATE_PER_SEC}), then refuses with retryAfterMs`, () => {
    let bucket = fullDraftBucket(t0);
    for (let i = 0; i < WS.DRAFT_RATE_PER_SEC; i++) {
      const take = takeDraftToken(bucket, t0);
      expect(take.ok).toBe(true);
      bucket = take.bucket;
    }
    const refused = takeDraftToken(bucket, t0);
    expect(refused).toEqual({
      ok: false,
      bucket: { tokens: 0, refilledAt: t0 },
      retryAfterMs: 1000 / WS.DRAFT_RATE_PER_SEC,
    });
  });

  it('refills at WS.DRAFT_RATE_PER_SEC per second, capped at a full bucket', () => {
    const empty = { tokens: 0, refilledAt: t0 };
    const interval = 1000 / WS.DRAFT_RATE_PER_SEC;
    expect(takeDraftToken(empty, t0 + interval - 1).ok).toBe(false);
    expect(takeDraftToken(empty, t0 + interval)).toEqual({
      ok: true,
      bucket: { tokens: 0, refilledAt: t0 + interval },
    });
    expect(takeDraftToken(empty, t0 + 60_000).bucket.tokens).toBe(WS.DRAFT_RATE_PER_SEC - 1);
  });

  it('retryAfterMs is never too early: retrying after it succeeds', () => {
    for (const tokens of [0, 0.25, 0.5, 0.99]) {
      const refused = takeDraftToken({ tokens, refilledAt: t0 }, t0);
      if (refused.ok) throw new Error(`expected a refusal with ${tokens} tokens`);
      expect(refused.retryAfterMs).toBeGreaterThan(0);
      expect(takeDraftToken(refused.bucket, t0 + refused.retryAfterMs).ok).toBe(true);
    }
  });

  it('does not drain when the clock steps back', () => {
    const take = takeDraftToken({ tokens: 2, refilledAt: t0 }, t0 - 5000);
    expect(take).toEqual({ ok: true, bucket: { tokens: 1, refilledAt: t0 - 5000 } });
  });
});
