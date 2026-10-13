import type { Area, AreaList } from '@cgis/shared';
import { describe, expect, it } from 'vitest';
import { applyRemoteDraftOp, type AreaWsEvent, patchAreas } from './areas-patch';
import { A1, A2, area, point, SELF } from './use-room.harness';

describe('patchAreas / applyRemoteDraftOp', () => {
  const created = (a: Area): AreaWsEvent => ({
    type: 'area:created',
    payload: { area: a },
    seq: 1,
    ts: 1,
  });

  it('upserts by id, keeps a newer cached version, and leaves an empty cache entry alone', () => {
    const list: AreaList = { areas: [area(A1, 2)] };
    expect(patchAreas(list, created(area(A2)))?.areas.map((a) => a.id)).toEqual([A1, A2]);
    expect(patchAreas(list, created(area(A1, 1)))).toBe(list);
    expect(patchAreas(list, created(area(A1, 3)))?.areas[0]?.version).toBe(3);
    expect(patchAreas(undefined, created(area(A1)))).toBeUndefined();
  });

  it("applies another user's op, ignores your own and ops that do not fit", () => {
    const [a, b] = [point(0), point(1)];
    const drafts = applyRemoteDraftOp([], { op: 'add', index: 0, vertex: a, userId: 'u2' }, SELF);
    expect(drafts).toEqual([{ userId: 'u2', vertices: [a] }]);
    expect(applyRemoteDraftOp(drafts, { op: 'add', index: 5, vertex: b, userId: 'u2' }, SELF)).toBe(
      drafts,
    );
    expect(applyRemoteDraftOp([], { op: 'add', index: 0, vertex: a, userId: SELF }, SELF)).toEqual(
      [],
    );
    expect(applyRemoteDraftOp(drafts, { op: 'clear', userId: 'u2' }, SELF)).toEqual([]);
  });
});
