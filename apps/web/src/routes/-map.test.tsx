// The leading '-' keeps the TanStack Router generator from treating this file as a route.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory } from '@tanstack/react-router';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { sessionQuery } from '../lib/session';
import { AppRouterProvider, createAppRouter } from '../router';

const signedIn = {
  session: { id: 'sess_1', userId: 'user_1' },
  user: { id: 'user_1', name: 'Ada Lovelace', email: 'ada@example.com' },
};

function stubGetSession(body: unknown, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json(body, { status })),
  );
}

function renderAppAt(path: string) {
  // jsdom has no scrollTo; the router resets scroll after each navigation.
  vi.stubGlobal('scrollTo', vi.fn());
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createAppRouter(queryClient, createMemoryHistory({ initialEntries: [path] }));
  render(
    <QueryClientProvider client={queryClient}>
      <AppRouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { queryClient, router };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('redirects a signed-out visitor from /map to /login', async () => {
  stubGetSession(null);
  const { router } = renderAppAt('/map');

  expect(await screen.findByRole('heading', { name: /sign in/i })).toBeTruthy();
  expect(router.state.location.pathname).toBe('/login');
  expect(screen.queryByTestId('map-root')).toBeNull();
});

it('treats a failing session check as signed out and lands on /login', async () => {
  stubGetSession({ code: 'NOT_IMPLEMENTED', message: 'not implemented' }, 501);
  const { router } = renderAppAt('/map');

  expect(await screen.findByRole('heading', { name: /sign in/i })).toBeTruthy();
  expect(router.state.location.pathname).toBe('/login');
});

it('renders the map route and the top bar for a signed-in user', async () => {
  stubGetSession(signedIn);
  const { router } = renderAppAt('/map');

  expect(await screen.findByTestId('map-root')).toBeTruthy();
  expect(router.state.location.pathname).toBe('/map');
  expect(screen.getByRole('heading', { name: /collaborative gis/i })).toBeTruthy();
  expect(screen.getByText('Ada Lovelace')).toBeTruthy();
  expect(screen.getByRole('button', { name: /sign out/i })).toBeTruthy();
});

it('redirects / to /map', async () => {
  stubGetSession(signedIn);
  const { router } = renderAppAt('/');

  expect(await screen.findByTestId('map-root')).toBeTruthy();
  expect(router.state.location.pathname).toBe('/map');
});

it('sends the user to /login when the session ends while on /map', async () => {
  stubGetSession(signedIn);
  const { queryClient, router } = renderAppAt('/map');
  await screen.findByTestId('map-root');

  act(() => {
    queryClient.setQueryData(sessionQuery.queryKey, null);
  });

  await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
  expect(await screen.findByRole('heading', { name: /sign in/i })).toBeTruthy();
  expect(screen.queryByText('Ada Lovelace')).toBeNull();
});
