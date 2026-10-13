// Test support for the useRoom tests: fixtures, a Leaflet map per test, and the hook rendered
// over fake sockets (use-room.test.tsx, use-room.resync.test.tsx).
import {
  applyDraftOp,
  type Area,
  type DraftOp,
  ERROR_CODES,
  ERROR_MESSAGES,
  type Position,
  QUERY,
  type WsClientEvent,
} from '@cgis/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook } from '@testing-library/react';
import * as L from 'leaflet';
import type { ReactNode } from 'react';
import { vi } from 'vitest';
import { fakeSockets, serverFrame } from './fake-websocket';
import { useRoom } from './use-room';

export const SELF = 'me';
export const bbox = [34, 31, 35, 32];
export const areasKey = [QUERY.AREAS_KEY, bbox];

export const area = (id: string, version = 1): Area => ({
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
export const A1 = '00000000-0000-4000-8000-000000000001';
export const A2 = '00000000-0000-4000-8000-000000000002';

/** Vertex `i` of a line of distinct vertices. */
export const point = (i: number): Position => [34 + i / 1000, 32];
/** `n` distinct vertices along a line. */
export const line = (n: number): Position[] => Array.from({ length: n }, (_, i) => point(i));

/** The current test's map: a live binding, set by `mountMap` (beforeEach). */
export let map: L.Map;
let element: HTMLDivElement;

/** beforeEach: fake timers and a fresh 800×600 map. */
export function mountMap(): void {
  vi.useFakeTimers();
  element = document.createElement('div');
  Object.defineProperty(element, 'clientWidth', { value: 800 });
  Object.defineProperty(element, 'clientHeight', { value: 600 });
  document.body.append(element);
  map = L.map(element, { center: [32, 35], zoom: 12 });
}

/** afterEach: unmounts the hook and the map, restores real timers and mocks. */
export function unmountMap(): void {
  cleanup();
  map.remove();
  element.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
}

export function renderRoom() {
  const fake = fakeSockets();
  const queryClient = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const view = renderHook(() => useRoom({ selfId: SELF, map }), {
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
export const draftState = (drafts: { userId: string; vertices: Position[] }[]) =>
  serverFrame({ type: 'draft:state', payload: { drafts } });

/** An `error` frame; `resync: true` asks the client to join again and resend its draft. */
export const errorFrame = (
  code: string,
  message: string,
  extra: { resync?: boolean; retryAfter?: number; frameSeq?: number | undefined } = {},
) => serverFrame({ type: 'error', payload: { code, message, ...extra } });

/** A frame the Room could not apply to its copy of the draft: the client must resync. */
export const misfit = errorFrame(ERROR_CODES.DRAFT_OP_MISFIT, ERROR_MESSAGES.DRAFT_OP_MISFIT, {
  resync: true,
});

/** Replays draft ops from an empty draft, the way the Room applies them. */
export function replay(ops: DraftOp[]): Position[] {
  return ops.reduce<Position[]>((vertices, op) => applyDraftOp(vertices, op) ?? vertices, []);
}
