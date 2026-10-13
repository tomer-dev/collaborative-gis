import {
  type AreaList,
  ERROR_CODES,
  ERROR_MESSAGES,
  MAP,
  type Position,
  QUERY,
  ROOM,
  WS,
} from '@cgis/shared';
import { QueryObserver } from '@tanstack/react-query';
import { act } from '@testing-library/react';
import * as L from 'leaflet';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from './api-client';
import { DRAFT_INTERVAL_MS } from './draft-sender';
import { serverFrame } from './fake-websocket';
import { createPolygonDraw } from './geo';
import {
  A1,
  A2,
  area,
  areasKey,
  errorFrame,
  line,
  map,
  mountMap,
  point,
  renderRoom,
  replay,
  SELF,
  unmountMap,
} from './use-room.harness';
import { backoffDelay } from './ws';

// The resync contract (an `error` with `resync: true`) is in use-room.resync.test.tsx.
beforeEach(mountMap);
afterEach(unmountMap);

describe('useRoom', () => {
  it('joins the default room on open, and re-sends drawing presence after the join on a reopen', () => {
    const room = renderRoom();
    room.open();
    expect(room.result.current.state).toBe('open');
    expect(room.socket().frames()).toEqual([
      expect.objectContaining({ type: 'join', payload: { mapId: ROOM.DEFAULT_ROOM_ID } }),
    ]);

    room.draw(line(1));
    expect(
      room
        .socket()
        .frames()
        .map((frame) => frame.type),
    ).toEqual(['join', 'presence:set', 'draft:update']);

    act(() => room.socket().drop(WS.CLOSE_IDLE));
    room.advance(backoffDelay(1, () => 0));
    room.open();
    expect(room.socket().frames().slice(0, 2)).toEqual([
      expect.objectContaining({ type: 'join' }),
      expect.objectContaining({ type: 'presence:set', payload: { state: 'drawing' } }),
    ]);
  });

  it('keeps presence and remote drafts while open, and drops them when the socket closes', () => {
    const room = renderRoom();
    room.open();
    const users = [
      { userId: SELF, name: 'Me', color: MAP.PRESENCE_COLORS[0], state: 'viewing' },
      { userId: 'u2', name: 'Bo', color: MAP.PRESENCE_COLORS[1], state: 'drawing' },
    ];
    const [a, b] = [point(0), point(1)];
    room.receive(serverFrame({ type: 'presence', payload: { users } }));
    room.receive(
      serverFrame({
        type: 'draft:state',
        payload: {
          drafts: [
            { userId: SELF, vertices: [a] },
            { userId: 'u2', vertices: [a] },
          ],
        },
      }),
    );
    room.receive(
      serverFrame({
        type: 'draft:update',
        payload: { op: 'add', index: 1, vertex: b, userId: 'u2' },
      }),
    );

    expect(room.result.current.users).toEqual(users);
    expect(room.result.current.drafts).toEqual([{ userId: 'u2', vertices: [a, b] }]);

    act(() => room.socket().drop(WS.CLOSE_IDLE));
    expect(room.result.current.users).toEqual([]);
    expect(room.result.current.drafts).toEqual([]);
  });

  it('patches area:created into [QUERY.AREAS_KEY, bbox] and removes on area:deleted', () => {
    const room = renderRoom();
    room.queryClient.setQueryData<AreaList>(areasKey, { areas: [area(A1)] });
    room.open();

    room.receive(serverFrame({ type: 'area:created', payload: { area: area(A2) }, mapVersion: 7 }));
    expect(
      room.queryClient.getQueryData<AreaList>(areasKey)?.areas.map((cached) => cached.id),
    ).toEqual([A1, A2]);

    room.receive(serverFrame({ type: 'area:updated', payload: { area: area(A1, 2) } }));
    expect(room.queryClient.getQueryData<AreaList>(areasKey)?.areas[0]?.version).toBe(2);

    room.receive(serverFrame({ type: 'area:deleted', payload: { id: A1 } }));
    expect(
      room.queryClient.getQueryData<AreaList>(areasKey)?.areas.map((cached) => cached.id),
    ).toEqual([A2]);
  });

  it('fetches a viewport again when an area event lands while its first GET is in flight', async () => {
    const room = renderRoom();
    room.open();
    let gets = 0;
    const viewport = new QueryObserver(room.queryClient, {
      queryKey: areasKey,
      queryFn: () => {
        gets += 1;
        return new Promise<AreaList>(() => {});
      },
    });
    const unsubscribe = viewport.subscribe(() => {});
    expect(gets).toBe(1);

    room.receive(serverFrame({ type: 'area:created', payload: { area: area(A2) } }));
    await act(async () => {});
    expect(gets).toBe(2);
    unsubscribe();
  });

  it('leaves a viewport with a list alone (patched, not refetched) on an area event', () => {
    const room = renderRoom();
    room.queryClient.setQueryData<AreaList>(areasKey, { areas: [area(A1)] });
    room.open();
    room.receive(serverFrame({ type: 'area:created', payload: { area: area(A2) } }));
    expect(room.queryClient.getQueryState(areasKey)?.isInvalidated).toBe(false);
  });

  it('invalidates the areas queries on every reopen (the resync), not on the first open', () => {
    const room = renderRoom();
    const invalidate = vi.spyOn(room.queryClient, 'invalidateQueries');
    room.open();
    expect(invalidate).not.toHaveBeenCalled();

    act(() => room.socket().drop(WS.CLOSE_IDLE));
    room.advance(backoffDelay(1, () => 0));
    expect(invalidate).not.toHaveBeenCalled();
    room.open();
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenLastCalledWith({ queryKey: [QUERY.AREAS_KEY] });
  });

  /** Drops every connect until offline; with Math.random at 0 the next wait outlasts a poll. */
  function dropUntilOffline(room: ReturnType<typeof renderRoom>) {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    for (let failures = 1; failures <= WS.CLIENT_OFFLINE_AFTER; failures++) {
      act(() => room.socket().drop(1006));
      if (failures < WS.CLIENT_OFFLINE_AFTER) room.advance(backoffDelay(failures, () => 0));
    }
    expect(backoffDelay(WS.CLIENT_OFFLINE_AFTER, () => 0)).toBeGreaterThan(WS.OFFLINE_POLL_MS);
    return room.socket();
  }
  const nextPoll = () => act(async () => void vi.advanceTimersByTime(WS.OFFLINE_POLL_MS));

  it('connects at once when a poll gets an answer again, then leaves the socket to its backoff', async () => {
    const room = renderRoom();
    const dropped = dropUntilOffline(room);

    await nextPoll();
    const retried = room.socket();
    expect(retried).not.toBe(dropped);

    // The API keeps answering while the Room refuses: no retry per poll, the backoff decides.
    act(() => retried.drop(1006));
    await nextPoll();
    expect(room.socket()).toBe(retried);
  });

  it('keeps the backoff while the polls fail: a failed poll says the network is still down', async () => {
    const room = renderRoom();
    const viewport = new QueryObserver(room.queryClient, {
      queryKey: areasKey,
      queryFn: () => Promise.reject(new Error('offline')),
      retry: false,
    });
    const unsubscribe = viewport.subscribe(() => {});
    const dropped = dropUntilOffline(room);

    await nextPoll();

    expect(room.socket()).toBe(dropped);
    unsubscribe();
  });

  it('resyncs on the first open when the connection degraded before it', () => {
    const room = renderRoom();
    const invalidate = vi.spyOn(room.queryClient, 'invalidateQueries');
    for (let failures = 1; failures <= WS.CLIENT_DEGRADED_AFTER; failures++) {
      act(() => room.socket().drop(1006));
      room.advance(backoffDelay(failures, () => 0));
    }
    room.open();
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it('polls the areas queries every WS.OFFLINE_POLL_MS while offline, and stops once open', () => {
    const room = renderRoom();
    const invalidate = vi.spyOn(room.queryClient, 'invalidateQueries');
    for (let failures = 1; failures < WS.CLIENT_OFFLINE_AFTER; failures++) {
      act(() => room.socket().drop(1006));
      room.advance(backoffDelay(failures, () => 0));
    }
    act(() => room.socket().drop(1006));
    expect(room.result.current.state).toBe('offline');
    // The degraded stretch before it polled already (next test); count from here.
    invalidate.mockClear();

    room.advance(WS.OFFLINE_POLL_MS);
    expect(invalidate).toHaveBeenCalledTimes(1);
    room.advance(WS.OFFLINE_POLL_MS);
    expect(invalidate).toHaveBeenCalledTimes(2);

    act(() => room.result.current.reconnect());
    room.open();
    const afterOpen = invalidate.mock.calls.length;
    room.advance(WS.OFFLINE_POLL_MS * 3);
    expect(invalidate).toHaveBeenCalledTimes(afterOpen);
  });

  it('polls while degraded too: no events arrive between the first failed connect and offline', () => {
    const room = renderRoom();
    const invalidate = vi.spyOn(room.queryClient, 'invalidateQueries');
    for (let failures = 1; failures < WS.CLIENT_DEGRADED_AFTER; failures++) {
      act(() => room.socket().drop(1006));
      room.advance(backoffDelay(failures, () => 0));
    }
    act(() => room.socket().drop(1006));
    expect(room.result.current.state).toBe('degraded');
    expect(invalidate).not.toHaveBeenCalled();

    room.advance(WS.OFFLINE_POLL_MS);
    expect(room.result.current.state).toBe('degraded');
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenLastCalledWith(
      { queryKey: [QUERY.AREAS_KEY] },
      { throwOnError: true },
    );
  });

  it('stops the offline poll once the areas API answers 401 (the session ended)', async () => {
    const room = renderRoom();
    for (let failures = 1; failures <= WS.CLIENT_OFFLINE_AFTER; failures++) {
      act(() => room.socket().drop(1006));
      room.advance(backoffDelay(failures, () => 0));
    }
    expect(room.result.current.state).toBe('offline');
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
    room.advance(WS.OFFLINE_POLL_MS * 3);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it(`throttles draw:change bursts to ${WS.DRAFT_RATE_PER_SEC} draft:update/s with ops that rebuild the sketch; draw:done sends clear`, () => {
    const room = renderRoom();
    room.open();
    const target = line(30);
    // 30 clicks in 600 ms, each reported twice: far more draw:change events than the budget.
    for (let i = 1; i <= target.length; i++) {
      room.draw(target.slice(0, i));
      room.advance(10);
      room.draw(target.slice(0, i));
      room.advance(10);
    }
    room.advance(DRAFT_INTERVAL_MS * target.length);

    const frames = room.drafts();
    for (const frame of frames) {
      const inWindow = frames.filter((f) => f.ts >= frame.ts && f.ts < frame.ts + 1000);
      expect(inWindow.length).toBeLessThanOrEqual(WS.DRAFT_RATE_PER_SEC);
    }
    expect(frames.map((frame) => frame.payload.op)).toEqual(target.map(() => 'add'));
    expect(replay(frames.map((frame) => frame.payload))).toEqual(target);

    const moved: Position[] = [[34.5, 32.5], ...target.slice(1)];
    room.draw(moved);
    room.advance(DRAFT_INTERVAL_MS);
    expect(room.drafts().at(-1)?.payload).toEqual({ op: 'move', index: 0, vertex: [34.5, 32.5] });

    act(() => void map.fire('draw:done', { ring: [...moved, moved[0]!] }));
    room.advance(DRAFT_INTERVAL_MS);
    expect(room.drafts().at(-1)?.payload).toEqual({ op: 'clear' });
    expect(room.socket().frames().at(-1)).toEqual(
      expect.objectContaining({ type: 'presence:set', payload: { state: 'viewing' } }),
    );
  });

  it('streams the real draw tool: a click is an add, a vertex drag one move at drag end, Finish a clear', () => {
    const room = renderRoom();
    room.open();
    const draw = createPolygonDraw(map, { pane: MAP.DRAFTS_PANE });
    act(() => draw.enable());
    // A Leaflet.Editable drawing click: map mousedown + mouseup with the left button.
    const click = (lat: number, lng: number) =>
      act(() => {
        const originalEvent = new MouseEvent('mousedown', { which: 1, clientX: 10, clientY: 10 });
        map.fire('mousedown', { latlng: L.latLng(lat, lng), originalEvent });
        map.fire('mouseup', { latlng: L.latLng(lat, lng), originalEvent });
      });
    click(32, 35);
    room.advance(DRAFT_INTERVAL_MS);
    click(32, 35.05);
    room.advance(DRAFT_INTERVAL_MS);
    click(32.05, 35.05);
    room.advance(DRAFT_INTERVAL_MS);
    expect(room.drafts().map((frame) => frame.payload.op)).toEqual(['add', 'add', 'add']);

    // A real marker drag on the second handle: mousedown, mousemoves, mouseup.
    const handle = map.getContainer().querySelectorAll('.cgis-draw-handle')[1];
    expect(handle).toBeDefined();
    const mouse = (type: string, x: number, y: number) =>
      act(
        () =>
          void handle?.dispatchEvent(
            new MouseEvent(type, { bubbles: true, button: 0, which: 1, clientX: x, clientY: y }),
          ),
      );
    mouse('mousedown', 100, 100);
    mouse('mousemove', 120, 80);
    mouse('mousemove', 140, 60);
    expect(room.drafts()).toHaveLength(3);
    mouse('mouseup', 140, 60);
    room.advance(DRAFT_INTERVAL_MS);
    expect(room.drafts().at(-1)?.payload).toEqual({
      op: 'move',
      index: 1,
      vertex: draw.getVertices()[1],
    });
    expect(room.drafts()).toHaveLength(4);

    act(() => void draw.finish());
    expect(room.drafts().at(-1)?.payload).toEqual({ op: 'clear' });
    expect(replay(room.drafts().map((frame) => frame.payload))).toEqual([]);
  });

  it('sends the first op at once and draw:cancel as clear', () => {
    const room = renderRoom();
    room.open();
    room.draw(line(1));
    expect(room.drafts()).toHaveLength(1);
    room.advance(DRAFT_INTERVAL_MS);
    act(() => void map.fire('draw:cancel'));
    expect(room.drafts().at(-1)?.payload).toEqual({ op: 'clear' });
  });

  it('RATE_LIMITED on the last op sent: pauses for retryAfter, then sends that op again, no clear', () => {
    const room = renderRoom();
    room.open();
    room.draw(line(20));
    room.advance(DRAFT_INTERVAL_MS * 2);
    const sent = room.drafts();
    expect(sent).toHaveLength(3);
    const refused = sent.at(-1);
    const retryAfter = 700;

    room.receive(
      errorFrame(ERROR_CODES.RATE_LIMITED, 'rate limited', { retryAfter, frameSeq: refused?.seq }),
    );
    room.advance(retryAfter - 1);
    expect(room.drafts()).toHaveLength(sent.length);

    room.advance(1 + DRAFT_INTERVAL_MS * 17);
    const after = room.drafts().slice(sent.length);
    // The refused op goes out once more, then the rest: nothing is cleared or sent twice.
    expect(after[0]?.payload).toEqual(refused?.payload);
    expect(after.map((frame) => frame.payload.op)).not.toContain('clear');
    expect(after).toHaveLength(18);
    const accepted = [...sent.slice(0, -1), ...after].map((frame) => frame.payload);
    expect(replay(accepted)).toEqual(line(20));
  });

  it('RATE_LIMITED on the add that starts a draft (the Room refused the session, D5): after retryAfter that add goes out again, no clear', () => {
    const room = renderRoom();
    room.open();
    room.draw(line(1));
    const [refused] = room.drafts();
    expect(refused?.payload).toEqual({ op: 'add', index: 0, vertex: line(1)[0] });
    const retryAfter = 30_000;

    room.receive(
      errorFrame(ERROR_CODES.RATE_LIMITED, 'rate limited', { retryAfter, frameSeq: refused?.seq }),
    );
    room.draw(line(2));
    room.advance(retryAfter - 1);
    expect(room.drafts()).toHaveLength(1);

    room.advance(1 + DRAFT_INTERVAL_MS);
    const after = room.drafts().slice(1);
    expect(after.map((frame) => frame.payload)).toEqual([refused?.payload, expect.anything()]);
    expect(replay(after.map((frame) => frame.payload))).toEqual(line(2));
  });

  it('RATE_LIMITED on an older op (ops were built on it since): restarts with clear and re-adds', () => {
    const room = renderRoom();
    room.open();
    room.draw(line(3));
    room.advance(DRAFT_INTERVAL_MS * 2);
    const before = room.drafts().length;
    const retryAfter = 700;

    room.receive(
      errorFrame(ERROR_CODES.RATE_LIMITED, 'rate limited', {
        retryAfter,
        frameSeq: room.drafts()[0]?.seq,
      }),
    );
    room.advance(retryAfter + DRAFT_INTERVAL_MS * 3);
    const resent = room.drafts().slice(before);
    expect(resent[0]?.payload).toEqual({ op: 'clear' });
    expect(replay(resent.map((frame) => frame.payload))).toEqual(line(3));
  });

  it('sends no draft while the socket is not open, and the whole draft after the next open', () => {
    const room = renderRoom();
    room.draw(line(2));
    room.advance(DRAFT_INTERVAL_MS * 4);
    expect(room.socket().sent).toEqual([]);

    room.open();
    room.advance(DRAFT_INTERVAL_MS * 4);
    const frames = room.socket().frames();
    expect(frames.map((frame) => frame.type)).toEqual([
      'join',
      'presence:set',
      'draft:update',
      'draft:update',
      'draft:update',
    ]);
    expect(replay(room.drafts().map((frame) => frame.payload))).toEqual(line(2));
  });
});
