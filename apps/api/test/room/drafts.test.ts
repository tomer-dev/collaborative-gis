import { LIMITS, type Position, WS } from '@cgis/shared';
import { describe, expect, it } from 'vitest';
import { applyDraftOp, freshDraftRate, takeDraftFrame } from '../../src/do/drafts';

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

describe('takeDraftFrame', () => {
  it(`counts WS.DRAFT_RATE_PER_SEC (${WS.DRAFT_RATE_PER_SEC}) frames a second, then refuses until the window ends`, () => {
    const t0 = 1_700_000_000_000;
    let rate = freshDraftRate(t0);
    for (let i = 0; i < WS.DRAFT_RATE_PER_SEC; i++) {
      const take = takeDraftFrame(rate, t0 + i);
      expect(take.ok).toBe(true);
      rate = take.rate;
    }
    expect(takeDraftFrame(rate, t0 + 400)).toEqual({ ok: false, rate, retryAfterMs: 600 });
    expect(takeDraftFrame(rate, t0 + 1000)).toEqual({
      ok: true,
      rate: { windowStart: t0 + 1000, frames: 1 },
    });
  });
});
