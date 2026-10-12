import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { useSession } from './session';

// A full Better Auth get-session payload: the hook keeps only the user's id and name.
const betterAuthSession = {
  session: {
    id: 'sess_1',
    token: 'tok_1',
    userId: 'user_1',
    expiresAt: '2026-10-19T00:00:00.000Z',
    createdAt: '2026-10-12T00:00:00.000Z',
    updatedAt: '2026-10-12T00:00:00.000Z',
    ipAddress: null,
    userAgent: null,
  },
  user: {
    id: 'user_1',
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    emailVerified: false,
    image: null,
    createdAt: '2026-10-12T00:00:00.000Z',
    updatedAt: '2026-10-12T00:00:00.000Z',
  },
};

function stubFetch(response: () => Promise<Response>) {
  const fetchMock = vi.fn(response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderUseSession() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook(() => useSession(), { wrapper });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('maps a Better Auth session to { id, name } from GET /api/auth/get-session', async () => {
  const fetchMock = stubFetch(async () => Response.json(betterAuthSession));
  const { result } = renderUseSession();

  expect(result.current).toEqual({ data: null, isPending: true });
  await waitFor(() => expect(result.current.isPending).toBe(false));

  expect(result.current).toEqual({
    data: { id: 'user_1', name: 'Ada Lovelace' },
    isPending: false,
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock).toHaveBeenCalledWith('/api/auth/get-session');
});

it('maps a signed-out response (JSON null) to data: null', async () => {
  stubFetch(async () => Response.json(null));
  const { result } = renderUseSession();

  await waitFor(() => expect(result.current.isPending).toBe(false));
  expect(result.current).toEqual({ data: null, isPending: false });
});

it('treats a failed session check as signed out', async () => {
  stubFetch(async () =>
    Response.json({ code: 'NOT_IMPLEMENTED', message: 'not implemented' }, { status: 501 }),
  );
  const { result } = renderUseSession();

  await waitFor(() => expect(result.current.isPending).toBe(false));
  expect(result.current).toEqual({ data: null, isPending: false });
});
