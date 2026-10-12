import {
  type Area,
  type AreaList,
  ERROR_CODES,
  MAP,
  type Position,
  QUERY,
  ROOM,
  WS,
  ERROR_MESSAGES,
  WS_MESSAGES,
  type WsClientEvent,
} from '@cgis/shared';
import { QueryClient, QueryClientProvider, QueryObserver } from '@tanstack/react-query';
import { act, cleanup, renderHook } from '@testing-library/react';
import * as L from 'leaflet';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from './api-client';
import { fakeSockets, serverFrame } from './fake-websocket';
import { createPolygonDraw } from './geo';
import {
  applyDraftOp,
  applyRemoteDraftOp,
  type AreaWsEvent,
  DRAFT_INTERVAL_MS,
  type DraftOp,
  nextDraftOp,
  patchAreas,
  useRoom,
} from './use-room';
import { backoffDelay } from './ws';

const SELF = 'me';
const bbox = [34, 31, 35, 32];
const areasKey = [QUERY.AREAS_KEY, bbox];

const area = (id: string, version = 1): Area => ({
  id,
  name: `Area ${id.slice(-1)}`,
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [34.1, 31.1],
        [34.2, 31.1],
        [34.2, 31.2],
        [34.1, 31.1],
      ],
    ],
  },
  areaKm2: 1,
  version,
  createdBy: 'u2',
  createdAt: '2026-10-12T00:00:00.000Z',
  updatedAt: '2026-10-12T00:00:00.000Z',
});
const A1 = '00000000-0000-4000-8000-000000000001';
const A2 = '00000000-0000-4000-8000-000000000002';

/** Vertex `i` of a line of distinct vertices. */
const point = (i: number): Position => [34 + i / 1000, 32];
/** `n` distinct vertices along a line. */
const line = (n: number): Position[] => Array.from({ length: n }, (_, i) => point(i));

let map: L.Map;
let element: HTMLDivElement;

beforeEach(() => {
  vi.useFakeTimers();
  element = document.createElement('div');
  Object.defineProperty(element, 'clientWidth', { value: 800 });
  Object.defineProperty(element, 'clientHeight', { value: 600 });
  document.body.append(element);
  map = L.map(element, { center: [32, 35], zoom: 12 });
});

afterEach(() => {
  cleanup();
  map.remove();
  element.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function renderRoom() {
  const fake = fakeSockets();
  const queryClient = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const view = renderHook(() => useRoom({ selfId: SELF, map, createSocket: fake.factory }), {
    wrapper,
  });
  const socket = () => fake.latest();
  /** Opens the current socket. */
  const open = () => act(() => socket().open());
  const receive = (frame: object) => act(() => socket().receive(frame));
  const drafts = () =>
    socket()
      .frames()
      .filter(
        (frame): frame is Extract<WsClientEvent, { type: 'draft:update' }> =>
          frame.type === 'draft:update',
      );
  const draw = (vertices: Position[]) => act(() => void map.fire('draw:change', { vertices }));
  const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
  /** `join` frames sent on the current socket. */
  const joins = () =>
    socket()
      .frames()
      .filter((frame) => frame.type === 'join').length;
  return { ...view, fake, queryClient, socket, open, receive, drafts, draw, advance, joins };
}

/** The Room's answer to a join (also broadcast after a departure): every current draft. */
const draftState = (drafts: { userId: string; vertices: Position[] }[]) =>
  serverFrame({ type: 'draft:state', payload: { drafts } });

/** An `error` frame; `resync: true` asks the client to join again and resend its draft. */
const errorFrame = (
  code: string,
  message: string,
  extra: { resync?: boolean; retryAfter?: number; frameSeq?: number | undefined } = {},
) => serverFrame({ type: 'error', payload: { code, message, ...extra } });

const stateLost = errorFrame(ERROR_CODES.CONFLICT, WS_MESSAGES.ROOM_STATE_LOST, { resync: true });

/** Replays draft ops from an empty draft, the way the Room applies them. */
function replay(ops: DraftOp[]): Position[] {
  return ops.reduce<Position[]>((vertices, op) => applyDraftOp(vertices, op) ?? vertices, []);
}

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
    expect(invalidate).not.toHaveBeenCalled();

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

    room.receive(stateLost);
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

    // Three frames were in flight when the state was lost: three errors, then the join's answer.
    room.receive(stateLost);
    room.receive(stateLost);
    room.receive(stateLost);
    expect(room.joins()).toBe(2);
    room.receive(draftState([]));
    room.advance(WS.RECONNECT_BACKOFF_MS.max * 2);
    expect(room.joins()).toBe(2);
    expect(room.result.current.state).toBe('open');

    // The join itself failed (error INTERNAL + resync in its place, no draft:state): sent again.
    room.receive(stateLost);
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
