import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// One test in this file: the real client keeps its session in a module-level store.
it('useSession reads the session through the Better Auth client at same-origin /api/auth/get-session', async () => {
  const fetchMock = vi.fn<typeof fetch>(async () =>
    Response.json({
      session: { id: 'sess_1', userId: 'user_1', token: 'tok_1' },
      user: { id: 'user_1', name: 'Ada Lovelace', email: 'ada@example.com' },
    }),
  );
  // Better Auth captures fetch when the client is created, so stub it before importing.
  vi.stubGlobal('fetch', fetchMock);
  const { useSession } = await import('./session');

  const { result } = renderHook(() => useSession());
  await waitFor(() => expect(result.current.isPending).toBe(false));

  expect(result.current.data).toMatchObject({ id: 'user_1', name: 'Ada Lovelace' });
  const input = fetchMock.mock.calls[0]?.[0];
  const url = new URL(input instanceof Request ? input.url : String(input));
  expect(url.origin).toBe(window.location.origin);
  expect(url.pathname).toBe('/api/auth/get-session');
});
