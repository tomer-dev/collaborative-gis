import {
  applyDraftOp,
  type Draft,
  type DraftOp,
  ERROR_CODES,
  ERROR_MESSAGES,
  MAP,
  type Position,
  type PresenceUser,
  type WsClientEvent,
  type WsEvent,
  WS_MESSAGES,
} from '@cgis/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook } from '@testing-library/react';
import * as L from 'leaflet';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DRAFT_INTERVAL_MS } from './draft-sender';
import { type FakeSocket, fakeSockets, serverFrame } from './fake-websocket';
import { useRoom } from './use-room';
import { backoffDelay } from './ws';

const SELF = 'me';
const USERS: PresenceUser[] = [
  { userId: SELF, name: 'Me', color: MAP.PRESENCE_COLORS[0], state: 'viewing' },
  { userId: 'u2', name: 'Bo', color: MAP.PRESENCE_COLORS[1], state: 'drawing' },
  { userId: 'u3', name: 'Cy', color: MAP.PRESENCE_COLORS[2], state: 'drawing' },
];
/** How often the fake Room reads the client's frames: well under the draft interval. */
const NETWORK_STEP_MS = 10;

type ServerEvent = Omit<WsEvent, 'seq' | 'ts'>;

/**
 * The Room on the far side of the fake sockets, cut down to what the resync contract needs: one
 * draft per user that outlives a killed socket (the Room keeps drafts in SQLite), `join` answered
 * with `presence` + the full `draft:state`, the client's ops applied with the Room's rule (a misfit
 * is `DRAFT_OP_MISFIT` + `resync`), other users' ops relayed. After `loseState()` every frame but
 * `join` is answered `CONFLICT` + `resync`, as the Room does for a socket that outlived its state.
 */
class FakeRoom {
  readonly drafts = new Map<string, Position[]>();
  private socket: FakeSocket | null = null;
  private handled = 0;
  private seq = 0;
  private outlived = false;

  /** The upgrade succeeds: `socket` is the client's connection from now on. */
  accept(socket: FakeSocket): void {
    this.socket = socket;
    this.handled = 0;
    socket.open();
  }

  /** The Room is killed (a deploy): the socket is cut with 1006 and no close frame; drafts stay. */
  kill(): void {
    this.socket?.drop(1006);
    this.socket = null;
  }

  /** The Room's storage is gone while the socket stays attached. */
  loseState(): void {
    this.drafts.clear();
    this.outlived = true;
  }

  /** Answers, in order, the frames the client sent since the last call. */
  serve(): void {
    const socket = this.socket;
    if (!socket) return;
    const frames = socket.frames();
    const fresh = frames.slice(this.handled);
    // Counted first: what the client sends while these are answered waits for the next call.
    this.handled = frames.length;
    for (const frame of fresh) this.handle(frame);
  }

  /** Another user's edit: stored, and relayed to the client while it is connected. */
  remote(userId: string, op: DraftOp): void {
    this.apply(userId, op);
    this.send({ type: 'draft:update', payload: { ...op, userId } });
  }

  /** What the client should show as ghosts: every other user's draft, by user id. */
  ghosts(): Draft[] {
    return [...this.drafts]
      .filter(([userId]) => userId !== SELF)
      .map(([userId, vertices]) => ({ userId, vertices }))
      .sort((a, b) => a.userId.localeCompare(b.userId));
  }

  private handle(frame: WsClientEvent): void {
    if (frame.type === 'join') {
      this.outlived = false;
      this.send({ type: 'presence', payload: { users: USERS } });
      this.send({ type: 'draft:state', payload: { drafts: this.all() } });
      return;
    }
    if (frame.type === 'leave') return;
    if (this.outlived) {
      this.error(ERROR_CODES.CONFLICT, WS_MESSAGES.ROOM_STATE_LOST);
      return;
    }
    if (frame.type === 'draft:update' && !this.apply(SELF, frame.payload)) {
      this.error(ERROR_CODES.DRAFT_OP_MISFIT, ERROR_MESSAGES.DRAFT_OP_MISFIT);
    }
  }

  private apply(userId: string, op: DraftOp): boolean {
    const next = applyDraftOp(this.drafts.get(userId) ?? [], op);
    if (!next) return false;
    if (next.length === 0) this.drafts.delete(userId);
    else this.drafts.set(userId, next);
    return true;
  }

  private all(): Draft[] {
    return [...this.drafts].map(([userId, vertices]) => ({ userId, vertices }));
  }

  private error(code: string, message: string): void {
    this.send({ type: 'error', payload: { code, message, resync: true } });
  }

  private send(event: ServerEvent): void {
    this.seq += 1;
    this.socket?.receive(serverFrame(event, this.seq));
  }
}

/** `n` distinct vertices along a line, offset so each user's sketch differs. */
const line = (n: number, offset = 0): Position[] =>
  Array.from({ length: n }, (_, i) => [34 + (offset + i) / 1000, 32]);
const add = (index: number, vertex: Position): DraftOp => ({ op: 'add', index, vertex });

let map: L.Map;
let element: HTMLDivElement;

beforeEach(() => {
  vi.useFakeTimers();
  // No jitter: every reconnect waits its full backoff.
  vi.spyOn(Math, 'random').mockReturnValue(0);
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

function setup() {
  const fake = fakeSockets();
  const room = new FakeRoom();
  const queryClient = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const view = renderHook(() => useRoom({ selfId: SELF, map }), {
    wrapper,
  });
  /** Time passes; the Room answers what arrived every `NETWORK_STEP_MS`. */
  const run = (ms: number) => {
    for (let elapsed = 0; elapsed < ms; elapsed += NETWORK_STEP_MS) {
      act(() => {
        vi.advanceTimersByTime(NETWORK_STEP_MS);
        room.serve();
      });
    }
  };
  /** The client's latest socket reaches the Room, which answers its first frames. */
  const connect = () => {
    act(() => room.accept(fake.latest()));
    run(NETWORK_STEP_MS);
  };
  const draw = (vertices: Position[]) => act(() => void map.fire('draw:change', { vertices }));
  const remote = (userId: string, op: DraftOp) => act(() => room.remote(userId, op));
  const joins = () =>
    fake.sockets.flatMap((socket) => socket.frames()).filter((frame) => frame.type === 'join')
      .length;
  /** The ghosts the hook shows, in the order `FakeRoom.ghosts()` uses. */
  const ghosts = () =>
    [...view.result.current.drafts].sort((a, b) => a.userId.localeCompare(b.userId));
  return { ...view, fake, room, run, connect, draw, remote, joins, ghosts };
}

it('a Room killed mid-draft twice: one ghost per remote user, and the local draft intact', () => {
  const { result, room, run, connect, draw, remote, ghosts } = setup();
  const [u2, u3] = [line(3, 100), line(1, 200)];
  connect();
  remote('u2', add(0, u2[0]!));
  remote('u3', add(0, u3[0]!));
  const local = line(6);
  draw(local.slice(0, 3));
  run(DRAFT_INTERVAL_MS * 3);
  expect(room.drafts.get(SELF)).toEqual(local.slice(0, 3));
  expect(ghosts()).toEqual(room.ghosts());

  // Kill 1, mid-draft: the user keeps drawing and u2 keeps editing while the socket is down.
  act(() => room.kill());
  expect(result.current.drafts).toEqual([]);
  draw(local.slice(0, 5));
  remote('u2', add(1, u2[1]!));
  run(backoffDelay(1, () => 0));
  connect();
  expect(result.current.state).toBe('open');
  // Kill 2 cuts the resend (clear + one add per vertex) halfway.
  run(DRAFT_INTERVAL_MS * 2);
  act(() => room.kill());
  draw(local);
  remote('u3', { op: 'move', index: 0, vertex: line(1, 201)[0]! });
  run(backoffDelay(1, () => 0));
  connect();
  run(DRAFT_INTERVAL_MS * (local.length + 2));

  expect(result.current.state).toBe('open');
  expect(room.drafts.get(SELF)).toEqual(local);
  expect(ghosts()).toEqual(room.ghosts());
  expect(ghosts().map((draft) => draft.userId)).toEqual(['u2', 'u3']);
  expect(result.current.users.map((user) => user.userId)).toEqual([SELF, 'u2', 'u3']);

  // Live again: a relayed edit lands on u2's one ghost.
  remote('u2', add(2, u2[2]!));
  expect(ghosts()).toEqual(room.ghosts());
  expect(ghosts()[0]?.vertices).toEqual(u2);
});

it('state lost under an open socket with frames in flight: one join, the draft resent, no duplicate ghost', () => {
  const { result, room, run, connect, draw, remote, joins, ghosts } = setup();
  const u2 = line(1, 100);
  connect();
  remote('u2', add(0, u2[0]!));
  const local = line(5);
  draw(local);
  run(DRAFT_INTERVAL_MS);

  // The storage goes; three more ops leave the client before the Room reads any of them.
  act(() => room.loseState());
  act(() => void vi.advanceTimersByTime(DRAFT_INTERVAL_MS * 3));
  run(DRAFT_INTERVAL_MS * (local.length + 2));

  expect(joins()).toBe(2);
  expect(result.current.state).toBe('open');
  expect(room.drafts.get(SELF)).toEqual(local);
  // u2's draft went with the storage (the join's draft:state replaced the ghost); u2's own client
  // resends it the same way.
  expect(ghosts()).toEqual([]);
  remote('u2', { op: 'clear' });
  remote('u2', add(0, u2[0]!));
  expect(ghosts()).toEqual(room.ghosts());
  expect(ghosts()).toHaveLength(1);
});
