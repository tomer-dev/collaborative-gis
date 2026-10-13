import { ERROR_CODES, ERROR_MESSAGES, ROOM, WS, WS_MESSAGES } from '@cgis/shared';
import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from './api-client';
import { DRAFT_INTERVAL_MS } from './draft-sender';
import { serverFrame } from './fake-websocket';
import {
  areasKey,
  draftState,
  errorFrame,
  line,
  mountMap,
  point,
  renderRoom,
  replay,
  SELF,
  misfit,
  unmountMap,
} from './use-room.harness';
import { backoffDelay } from './ws';

beforeEach(mountMap);
afterEach(unmountMap);

describe('useRoom resync (an error with resync: true)', () => {
  it('joins again on the same socket, then sends drawing presence and the draft as clear + adds under the rate; the draft:state replaces the ghosts', () => {
    const room = renderRoom();
    const invalidate = vi.spyOn(room.queryClient, 'invalidateQueries');
    room.open();
    const [a, b, c] = [point(0), point(1), point(2)];
    room.receive(
      draftState([
        { userId: 'u2', vertices: [a] },
        { userId: 'u3', vertices: [a, b] },
      ]),
    );
    const vertices = line(15);
    room.draw(vertices);
    room.advance(DRAFT_INTERVAL_MS * vertices.length);
    const before = room.socket().frames().length;

    room.receive(misfit);
    expect(room.result.current.state).toBe('resyncing');
    room.advance(DRAFT_INTERVAL_MS * (vertices.length + 1));

    const resent = room.socket().frames().slice(before);
    expect(resent.slice(0, 2)).toEqual([
      expect.objectContaining({ type: 'join', payload: { mapId: ROOM.DEFAULT_ROOM_ID } }),
      expect.objectContaining({ type: 'presence:set', payload: { state: 'drawing' } }),
    ]);
    const ops = room.drafts().slice(-(vertices.length + 1));
    expect(ops.map((frame) => frame.payload.op)).toEqual(['clear', ...vertices.map(() => 'add')]);
    expect(replay(ops.map((frame) => frame.payload))).toEqual(vertices);
    for (const [i, frame] of ops.entries()) {
      const previous = ops[i - 1];
      if (previous) expect(frame.ts - previous.ts).toBeGreaterThanOrEqual(DRAFT_INTERVAL_MS);
    }
    expect(invalidate).not.toHaveBeenCalled();
    // The ghosts stay until the Room's answer, which replaces them (u3 is gone, u2 changed).
    expect(room.result.current.drafts).toHaveLength(2);

    room.receive(
      draftState([
        { userId: 'u2', vertices: [a, b] },
        { userId: SELF, vertices: [a] },
      ]),
    );
    expect(room.result.current.state).toBe('open');
    expect(room.result.current.drafts).toEqual([{ userId: 'u2', vertices: [a, b] }]);

    room.receive(
      serverFrame({
        type: 'draft:update',
        payload: { op: 'add', index: 2, vertex: c, userId: 'u2' },
      }),
    );
    expect(room.result.current.drafts).toEqual([{ userId: 'u2', vertices: [a, b, c] }]);
  });

  it('acts on the resync flag, whatever the code', () => {
    const room = renderRoom();
    room.open();
    room.receive(draftState([]));
    room.draw(line(2));
    room.advance(DRAFT_INTERVAL_MS * 2);
    const sent = room.drafts().length;

    room.receive(errorFrame(ERROR_CODES.DRAFT_OP_MISFIT, ERROR_MESSAGES.DRAFT_OP_MISFIT));
    room.receive(errorFrame(ERROR_CODES.BAD_REQUEST, WS_MESSAGES.NOT_JOINED));
    room.advance(DRAFT_INTERVAL_MS * 4);
    expect(room.joins()).toBe(1);
    expect(room.drafts()).toHaveLength(sent);

    room.receive(errorFrame(ERROR_CODES.INTERNAL, ERROR_MESSAGES.INTERNAL, { resync: true }));
    room.advance(DRAFT_INTERVAL_MS * 4);
    expect(room.joins()).toBe(2);
    expect(
      room
        .drafts()
        .slice(sent)
        .map((frame) => frame.payload.op),
    ).toEqual(['clear', 'add', 'add']);
  });

  it('sends one join at a time: errors before its draft:state are for earlier frames; an unanswered join is sent again after the backoff', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const room = renderRoom();
    room.open();
    room.receive(draftState([]));

    // Three frames were in flight when the Room's copy diverged: three errors, then the join's answer.
    room.receive(misfit);
    room.receive(misfit);
    room.receive(misfit);
    expect(room.joins()).toBe(2);
    room.receive(draftState([]));
    room.advance(WS.RECONNECT_BACKOFF_MS.max * 2);
    expect(room.joins()).toBe(2);
    expect(room.result.current.state).toBe('open');

    // The join itself failed (error INTERNAL + resync in its place, no draft:state): sent again.
    room.receive(misfit);
    room.receive(errorFrame(ERROR_CODES.INTERNAL, ERROR_MESSAGES.INTERNAL, { resync: true }));
    expect(room.joins()).toBe(3);
    room.advance(backoffDelay(1, () => 0) - 1);
    expect(room.joins()).toBe(3);
    room.advance(1);
    expect(room.joins()).toBe(4);
    expect(room.result.current.state).toBe('resyncing');

    room.receive(draftState([]));
    expect(room.result.current.state).toBe('open');
    room.advance(WS.RECONNECT_BACKOFF_MS.max * 2);
    expect(room.joins()).toBe(4);
  });

  it("a failed first join (error + resync before its draft:state): 'resyncing', joined again after the backoff", () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const room = renderRoom();
    room.open();
    room.receive(errorFrame(ERROR_CODES.INTERNAL, ERROR_MESSAGES.INTERNAL, { resync: true }));
    expect(room.result.current.state).toBe('resyncing');
    expect(room.joins()).toBe(1);
    room.advance(backoffDelay(1, () => 0));
    expect(room.joins()).toBe(2);
    room.receive(draftState([]));
    expect(room.result.current.state).toBe('open');
  });

  it("is 'resyncing' from a reopen until the join's draft:state, never on the first open", () => {
    const room = renderRoom();
    room.open();
    expect(room.result.current.state).toBe('open');
    room.receive(draftState([]));

    act(() => room.socket().drop(WS.CLOSE_IDLE));
    room.advance(backoffDelay(1, () => 0));
    room.open();
    expect(room.result.current.state).toBe('resyncing');
    room.receive(serverFrame({ type: 'presence', payload: { users: [] } }));
    expect(room.result.current.state).toBe('resyncing');
    room.receive(draftState([]));
    expect(room.result.current.state).toBe('open');
  });

  it('a 401 on the upgrade does not loop: with an areas query holding a 401, a failed connect stops the retries until Retry', async () => {
    const room = renderRoom();
    const signedOut = new ApiRequestError(401, {
      code: ERROR_CODES.UNAUTHORIZED,
      message: ERROR_MESSAGES.UNAUTHORIZED,
    });
    await act(() =>
      room.queryClient
        .fetchQuery({ queryKey: areasKey, queryFn: () => Promise.reject(signedOut) })
        .catch(() => undefined),
    );
    const invalidate = vi.spyOn(room.queryClient, 'invalidateQueries');

    // A refused upgrade reaches the page as a close with no open (the status is not exposed).
    act(() => room.socket().drop(1006));
    expect(room.result.current.state).toBe('offline');
    const sockets = room.fake.sockets.length;
    room.advance(WS.RECONNECT_BACKOFF_MS.max * 4);
    expect(room.fake.sockets).toHaveLength(sockets);
    expect(invalidate).not.toHaveBeenCalled();

    act(() => room.result.current.reconnect());
    expect(room.fake.sockets).toHaveLength(sockets + 1);
  });
});
