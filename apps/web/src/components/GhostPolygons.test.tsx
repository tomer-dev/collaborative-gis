import { MAP, type Draft, type PresenceUser } from '@cgis/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render } from '@testing-library/react';
import * as L from 'leaflet';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { fakeSockets, serverFrame } from '../lib/fake-websocket';
import { useRoom } from '../lib/use-room';
import type { SocketFactory } from '../lib/ws';
import { GhostPolygons } from './GhostPolygons';

let map: L.Map;
let element: HTMLDivElement;

beforeEach(() => {
  element = document.createElement('div');
  Object.defineProperty(element, 'clientWidth', { value: 800 });
  Object.defineProperty(element, 'clientHeight', { value: 600 });
  document.body.append(element);
  map = L.map(element, { center: [32, 35], zoom: 12 });
  map.createPane(MAP.DRAFTS_PANE);
});

afterEach(() => {
  cleanup();
  map.remove();
  element.remove();
});

const [blue, orange] = MAP.PRESENCE_COLORS;
const users: PresenceUser[] = [
  { userId: 'me', name: 'Me', color: blue, state: 'drawing' },
  { userId: 'u2', name: 'Bo', color: orange, state: 'drawing' },
];
const triangle: Draft['vertices'] = [
  [35, 32],
  [35.01, 32],
  [35, 32.01],
];

const ghosts = () => Array.from(map.getPane(MAP.DRAFTS_PANE)!.querySelectorAll('path'));

/** The map route's wiring: the room hook feeding the ghost layer. */
function Room({ createSocket }: { createSocket: SocketFactory }) {
  const room = useRoom({ selfId: 'me', map, createSocket });
  return <GhostPolygons map={map} drafts={room.drafts} users={room.users} />;
}

it("draws another user's draft:update as a dashed ghost in their colour; clear removes it", () => {
  const fake = fakeSockets();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Room createSocket={fake.factory} />
    </QueryClientProvider>,
  );
  const receive = (frame: object) => act(() => fake.latest().receive(frame));
  act(() => fake.latest().open());
  receive(serverFrame({ type: 'presence', payload: { users } }));

  triangle.forEach((vertex, index) =>
    receive(
      serverFrame({ type: 'draft:update', payload: { op: 'add', index, vertex, userId: 'u2' } }),
    ),
  );

  const [ghost] = ghosts();
  expect(ghosts()).toHaveLength(1);
  expect(ghost!.getAttribute('stroke')).toBe(orange);
  expect(ghost!.getAttribute('fill')).toBe(orange);
  expect(ghost!.getAttribute('stroke-dasharray')).toBe(MAP.DRAFT_STYLE.dashArray);
  expect(ghost!.classList.contains('map-ghost')).toBe(true);

  receive(serverFrame({ type: 'draft:update', payload: { op: 'clear', userId: 'u2' } }));
  expect(ghosts()).toHaveLength(0);
});

it('follows the drafts it is given: moves a ghost in place, skips authors without a colour, cleans up on unmount', () => {
  const draw = (drafts: Draft[]) => <GhostPolygons map={map} drafts={drafts} users={users} />;
  const view = render(draw([{ userId: 'u2', vertices: triangle }]));
  const [first] = ghosts();
  const before = first!.getAttribute('d');

  view.rerender(
    draw([
      { userId: 'u2', vertices: [[35.02, 32], ...triangle.slice(1)] },
      { userId: 'stranger', vertices: triangle },
    ]),
  );
  expect(ghosts()).toEqual([first]);
  expect(first!.getAttribute('d')).not.toBe(before);

  view.unmount();
  expect(ghosts()).toHaveLength(0);
});
