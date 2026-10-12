import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useSession } from './session';

// What Better Auth's authClient.useSession() returns (only the fields useSession reads).
type BetterAuthSessionState = {
  data: { user: { id: string; name: string; email: string } } | null;
  isPending: boolean;
};

const auth = vi.hoisted(() => {
  const state: { current: BetterAuthSessionState } = {
    current: { data: null, isPending: true },
  };
  return state;
});

vi.mock('./auth-client', () => ({ authClient: { useSession: () => auth.current } }));

afterEach(cleanup);

it('is pending with no user until Better Auth answers', () => {
  auth.current = { data: null, isPending: true };
  const { result } = renderHook(() => useSession());

  expect(result.current).toEqual({ data: null, isPending: true });
});

it("exposes Better Auth's session user as data", () => {
  auth.current = {
    data: { user: { id: 'user_1', name: 'Ada Lovelace', email: 'ada@example.com' } },
    isPending: false,
  };
  const { result } = renderHook(() => useSession());

  expect(result.current.isPending).toBe(false);
  expect(result.current.data).toMatchObject({ id: 'user_1', name: 'Ada Lovelace' });
});

it('maps a signed-out (or failed) session to data: null', () => {
  auth.current = { data: null, isPending: false };
  const { result } = renderHook(() => useSession());

  expect(result.current).toEqual({ data: null, isPending: false });
});
