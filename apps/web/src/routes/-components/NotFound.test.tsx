// The leading '-' on the folder keeps the TanStack Router generator from treating this as a route.
import { COPY, ROUTES } from '@cgis/shared/constants';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory } from '@tanstack/react-router';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppRouterProvider, createAppRouter } from '../../router';

// A signed-out, already-checked Better Auth session; the not-found page needs no user.
vi.mock('../../lib/auth-client', () => ({
  authClient: { useSession: () => ({ data: null, isPending: false }) },
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('unknown path', () => {
  it('renders the not-found page inside the app frame with a link to the map', async () => {
    // jsdom has no scrollTo; the router resets scroll after each navigation.
    vi.stubGlobal('scrollTo', vi.fn());
    const queryClient = new QueryClient();
    const router = createAppRouter(queryClient, createMemoryHistory({ initialEntries: ['/nope'] }));
    render(
      <QueryClientProvider client={queryClient}>
        <AppRouterProvider router={router} />
      </QueryClientProvider>,
    );

    expect(await screen.findByRole('heading', { name: COPY.NOT_FOUND.TITLE })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: COPY.APP.NAME })).toBeTruthy();
    expect(screen.getByText(COPY.NOT_FOUND.BODY)).toBeTruthy();
    expect(screen.getByRole('link', { name: COPY.NOT_FOUND.LINK }).getAttribute('href')).toBe(
      ROUTES.APP.MAP,
    );
    expect(router.state.location.pathname).toBe('/nope');
  });
});
