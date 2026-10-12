// The leading '-' keeps the TanStack Router generator from treating this file as a route.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory } from '@tanstack/react-router';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AppRouterProvider, createAppRouter } from '../router';

// What Better Auth's authClient.useSession() returns (only the fields the app reads).
type BetterAuthSessionState = {
  data: { user: { id: string; name: string } } | null;
  isPending: boolean;
};

const signedIn: BetterAuthSessionState = {
  data: { user: { id: 'user_1', name: 'Ada Lovelace' } },
  isPending: false,
};
const signedOut: BetterAuthSessionState = { data: null, isPending: false };

const auth = vi.hoisted(() => {
  const state: { current: BetterAuthSessionState } = {
    current: { data: null, isPending: true },
  };
  return state;
});

vi.mock('../lib/auth-client', () => ({ authClient: { useSession: () => auth.current } }));

function renderAppAt(path: string, session: BetterAuthSessionState) {
  auth.current = session;
  // jsdom has no scrollTo; the router resets scroll after each navigation.
  vi.stubGlobal('scrollTo', vi.fn());
  // jsdom has no ResizeObserver; the map view observes its container.
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  const queryClient = new QueryClient();
  const router = createAppRouter(queryClient, createMemoryHistory({ initialEntries: [path] }));
  // A fresh element each time: React skips re-rendering an identical element object.
  const app = () => (
    <QueryClientProvider client={queryClient}>
      <AppRouterProvider router={router} />
    </QueryClientProvider>
  );
  const { rerender } = render(app());
  return { router, rerenderApp: () => rerender(app()) };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('shows a status and no route while the session is pending', () => {
  renderAppAt('/map', { data: null, isPending: true });

  expect(screen.getByRole('status').textContent).toMatch(/checking your session/i);
  expect(screen.queryByTestId('map-root')).toBeNull();
});

it('redirects a signed-out visitor from /map to /login', async () => {
  const { router } = renderAppAt('/map', signedOut);

  expect(await screen.findByRole('heading', { name: /sign in/i })).toBeTruthy();
  expect(router.state.location.pathname).toBe('/login');
  expect(screen.queryByTestId('map-root')).toBeNull();
  // /login has the minimal header: the app name, no user chip.
  expect(screen.getByRole('heading', { name: /collaborative gis/i })).toBeTruthy();
  expect(screen.queryByRole('button', { name: /sign out/i })).toBeNull();
});

it('renders the map route and the top bar for a signed-in user', async () => {
  const { router } = renderAppAt('/map', signedIn);

  const mapRoot = await screen.findByTestId('map-root');
  expect(router.state.location.pathname).toBe('/map');
  // /map renders inside the pathless _authed layout, which owns the guard and the user chip.
  expect(router.state.matches.map((match) => match.routeId)).toEqual([
    '__root__',
    '/_authed',
    '/_authed/map',
  ]);
  expect(within(mapRoot).getByRole('region', { name: 'Map' }).classList).toContain(
    'leaflet-container',
  );
  expect(screen.getByRole('heading', { name: /collaborative gis/i })).toBeTruthy();
  expect(screen.getByText('Ada Lovelace')).toBeTruthy();
  expect(screen.getByRole('button', { name: /sign out/i })).toBeTruthy();
});

it('redirects / to /map', async () => {
  const { router } = renderAppAt('/', signedIn);

  expect(await screen.findByTestId('map-root')).toBeTruthy();
  expect(router.state.location.pathname).toBe('/map');
});

it('sends the user to /login when the session ends while on /map', async () => {
  const { router, rerenderApp } = renderAppAt('/map', signedIn);
  await screen.findByTestId('map-root');

  auth.current = signedOut;
  rerenderApp();

  await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
  expect(await screen.findByRole('heading', { name: /sign in/i })).toBeTruthy();
  expect(screen.queryByText('Ada Lovelace')).toBeNull();
});
