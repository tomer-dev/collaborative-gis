import { WS } from '@cgis/shared';
import { describe, expect, it } from 'vitest';
import { freshDraftRate, takeDraftFrame } from '../../src/do/drafts';

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
