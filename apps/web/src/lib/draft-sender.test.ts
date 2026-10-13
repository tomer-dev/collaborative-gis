import { applyDraftOp } from '@cgis/shared';
import { describe, expect, it } from 'vitest';
import { nextDraftOp } from './draft-sender';
import { line, point } from './use-room.harness';

describe('nextDraftOp', () => {
  const [a, b, c, x] = [point(0), point(1), point(2), point(9)];

  it('maps the draw gestures to one op each', () => {
    expect(nextDraftOp([], [a])).toEqual({ op: 'add', index: 0, vertex: a });
    expect(nextDraftOp([a, b], [a, b, c])).toEqual({ op: 'add', index: 2, vertex: c });
    expect(nextDraftOp([a, b, c], [a, x, c])).toEqual({ op: 'move', index: 1, vertex: x });
    expect(nextDraftOp([a, b, c], [a, b])).toEqual({ op: 'remove', index: 2 });
    expect(nextDraftOp([a, b, c], [a, c])).toEqual({ op: 'remove', index: 1 });
    expect(nextDraftOp([a, c], [a, b, c])).toEqual({ op: 'add', index: 1, vertex: b });
    expect(nextDraftOp([a, b], [])).toEqual({ op: 'clear' });
    expect(nextDraftOp([a, b], [a, b])).toBeNull();
    expect(nextDraftOp([], [])).toBeNull();
  });

  it('converges from any copy to any target in at most |sent| + |target| ops', () => {
    const pool = line(8);
    const pick = (seed: number, length: number) =>
      Array.from({ length }, (_, i) => pool[(seed * 7 + i * 3) % pool.length]!);
    for (let s = 0; s < 6; s++) {
      for (let t = 0; t < 6; t++) {
        let sent = pick(s, s);
        const target = pick(t + 1, t + 1);
        let steps = 0;
        for (let op = nextDraftOp(sent, target); op; op = nextDraftOp(sent, target)) {
          sent = applyDraftOp(sent, op) ?? [];
          steps += 1;
        }
        expect(sent).toEqual(target);
        expect(steps).toBeLessThanOrEqual(s + t + 1);
      }
    }
  });
});
