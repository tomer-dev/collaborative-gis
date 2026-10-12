// The leading '-' keeps the TanStack Router generator from treating this file as a route.
import { COPY, LIMITS, ROUTES } from '@cgis/shared/constants';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory } from '@tanstack/react-router';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeSocket } from '../lib/fake-websocket';
import { AppRouterProvider, createAppRouter } from '../router';

// What Better Auth's authClient.useSession() returns (only the fields the app reads).
type BetterAuthSession = {
  data: { user: { id: string; name: string } } | null;
  isPending: boolean;
};

// A fake Better Auth client: useSession reads a tiny external store, the calls are mocks.
const auth = vi.hoisted(() => {
  let state: BetterAuthSession = { data: null, isPending: true };
  const listeners = new Set<() => void>();
  return {
    get: (): BetterAuthSession => state,
    set(next: BetterAuthSession) {
      state = next;
      for (const listener of listeners) listener();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    signInEmail: vi.fn(),
    signUpEmail: vi.fn(),
    signOut: vi.fn(),
  };
});

vi.mock('../lib/auth-client', async () => {
  const { useSyncExternalStore } = await import('react');
  return {
    authClient: {
      useSession: () => useSyncExternalStore(auth.subscribe, auth.get),
      signIn: { email: auth.signInEmail },
      signUp: { email: auth.signUpEmail },
      signOut: auth.signOut,
    },
  };
});

const ada = { id: 'user_1', name: 'Ada Lovelace' };
const signedIn: BetterAuthSession = { data: { user: ada }, isPending: false };
const signedOut: BetterAuthSession = { data: null, isPending: false };
const ok = (data: unknown) => ({ data, error: null });
const failed = (status: number, message?: string) => ({
  data: null,
  error: { status, statusText: '', ...(message ? { message } : {}) },
});

/**
 * What Better Auth's client does after a successful sign-in, sign-up or sign-out: refetch
 * get-session. It is pending while the old session was empty, then holds the new session.
 */
async function betterAuthRefetch(next: BetterAuthSession['data']) {
  const { data } = auth.get();
  await act(async () => auth.set({ data, isPending: data === null }));
  await act(async () => auth.set({ data: next, isPending: false }));
}

function renderAppAt(path: string, session: BetterAuthSession) {
  auth.set(session);
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
  // /map opens the room socket; keep it in memory (never opened, so the room stays connecting).
  vi.stubGlobal('WebSocket', FakeSocket);
  const queryClient = new QueryClient();
  const router = createAppRouter(queryClient, createMemoryHistory({ initialEntries: [path] }));
  // Every path the router settles on, to prove a sign-in never lands back on /login.
  const resolved: string[] = [];
  router.subscribe('onResolved', (event) => resolved.push(event.toLocation.pathname));
  render(
    <QueryClientProvider client={queryClient}>
      <AppRouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router, resolved };
}

function fill(label: string, value: string) {
  // Labels end in an aria-hidden " *" for required fields, so match on the label's start.
  fireEvent.change(screen.getByLabelText(label, { exact: false }), { target: { value } });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

describe('/login', () => {
  it('shows the session status on the first check only, not during a later refetch', async () => {
    renderAppAt(ROUTES.APP.LOGIN, { data: null, isPending: true });
    expect(screen.getByRole('status').textContent).toBe(COPY.AUTH.SESSION_CHECKING);
    await act(async () => auth.set(signedOut));
    await screen.findByRole('heading', { name: COPY.AUTH.LOGIN_TITLE });

    // What Better Auth does while signed out and refetching (after a sign-in, for one).
    await act(async () => auth.set({ data: null, isPending: true }));
    expect(screen.queryByText(COPY.AUTH.SESSION_CHECKING)).toBeNull();
    expect(screen.getByRole('heading', { name: COPY.AUTH.LOGIN_TITLE })).toBeTruthy();
  });

  it('signs in through authClient, then lands on /map once Better Auth has the session', async () => {
    auth.signInEmail.mockResolvedValue(ok({ redirect: false, token: 'tok_1', user: ada }));
    const { router, resolved } = renderAppAt(ROUTES.APP.LOGIN, signedOut);
    await screen.findByRole('heading', { name: COPY.AUTH.LOGIN_TITLE });

    fill(COPY.AUTH.EMAIL_LABEL, 'ada@example.com');
    fill(COPY.AUTH.PASSWORD_LABEL, 'correct horse');
    fireEvent.click(screen.getByRole('button', { name: COPY.AUTH.LOGIN_SUBMIT }));

    await waitFor(() =>
      expect(auth.signInEmail).toHaveBeenCalledWith({
        email: 'ada@example.com',
        password: 'correct horse',
      }),
    );
    // The form writes no session itself: the route only changes when Better Auth's does.
    expect(router.state.location.pathname).toBe(ROUTES.APP.LOGIN);

    await betterAuthRefetch(signedIn.data);

    expect(await screen.findByTestId('map-root')).toBeTruthy();
    expect(router.state.location.pathname).toBe(ROUTES.APP.MAP);
    expect(screen.getByText(ada.name)).toBeTruthy();
    // /login, then straight to /map: the _authed guard never bounced the user back.
    expect(resolved).toEqual([ROUTES.APP.LOGIN, ROUTES.APP.MAP]);
  });

  it('shows the server message in an alert on a wrong password and stays on /login', async () => {
    auth.signInEmail.mockResolvedValue(failed(401, 'Invalid email or password'));
    const { router } = renderAppAt(ROUTES.APP.LOGIN, signedOut);
    await screen.findByRole('heading', { name: COPY.AUTH.LOGIN_TITLE });

    fill(COPY.AUTH.EMAIL_LABEL, 'ada@example.com');
    fill(COPY.AUTH.PASSWORD_LABEL, 'wrong password');
    fireEvent.click(screen.getByRole('button', { name: COPY.AUTH.LOGIN_SUBMIT }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Invalid email or password');
    expect(alert.textContent).toContain(COPY.AUTH.LOGIN_ERROR_TITLE);
    expect(router.state.location.pathname).toBe(ROUTES.APP.LOGIN);
    // The form keeps what was typed and can be submitted again.
    expect(screen.getByRole('textbox', { name: COPY.AUTH.EMAIL_LABEL })).toHaveProperty(
      'value',
      'ada@example.com',
    );
    expect(screen.getByRole('button', { name: COPY.AUTH.LOGIN_SUBMIT })).toHaveProperty(
      'disabled',
      false,
    );
  });

  it('shows the generic copy when the failure carries no message', async () => {
    auth.signInEmail.mockResolvedValue(failed(502));
    renderAppAt(ROUTES.APP.LOGIN, signedOut);
    await screen.findByRole('heading', { name: COPY.AUTH.LOGIN_TITLE });

    fill(COPY.AUTH.EMAIL_LABEL, 'ada@example.com');
    fill(COPY.AUTH.PASSWORD_LABEL, 'correct horse');
    fireEvent.click(screen.getByRole('button', { name: COPY.AUTH.LOGIN_SUBMIT }));

    expect((await screen.findByRole('alert')).textContent).toContain(COPY.AUTH.ERROR_GENERIC);
  });

  it('rejects unparseable form data without calling Better Auth', async () => {
    renderAppAt(ROUTES.APP.LOGIN, signedOut);
    const button = await screen.findByRole('button', { name: COPY.AUTH.LOGIN_SUBMIT });

    // A direct submit event skips the native required check; the Zod parse still refuses.
    const form = button.closest('form');
    if (!form) throw new Error('submit button is outside a form');
    fireEvent.submit(form);

    expect((await screen.findByRole('alert')).textContent).toContain(COPY.AUTH.ERROR_GENERIC);
    expect(auth.signInEmail).not.toHaveBeenCalled();
  });

  it('disables the submit button while the request is pending', async () => {
    let respond: (result: unknown) => void = () => {};
    auth.signInEmail.mockReturnValue(
      new Promise((resolve) => {
        respond = resolve;
      }),
    );
    renderAppAt(ROUTES.APP.LOGIN, signedOut);
    await screen.findByRole('heading', { name: COPY.AUTH.LOGIN_TITLE });

    fill(COPY.AUTH.EMAIL_LABEL, 'ada@example.com');
    fill(COPY.AUTH.PASSWORD_LABEL, 'correct horse');
    fireEvent.click(screen.getByRole('button', { name: COPY.AUTH.LOGIN_SUBMIT }));

    const busy = await screen.findByRole('button', { name: COPY.AUTH.LOGIN_PENDING });
    expect(busy).toHaveProperty('disabled', true);

    await act(async () => respond(ok({ redirect: false, token: 'tok_1', user: ada })));
    expect(await screen.findByRole('button', { name: COPY.AUTH.LOGIN_SUBMIT })).toHaveProperty(
      'disabled',
      false,
    );
  });

  it('marks the fields required and uses sign-in autocomplete hints', async () => {
    renderAppAt(ROUTES.APP.LOGIN, signedOut);
    await screen.findByRole('heading', { name: COPY.AUTH.LOGIN_TITLE });

    const email = screen.getByLabelText(COPY.AUTH.EMAIL_LABEL, { exact: false });
    const password = screen.getByLabelText(COPY.AUTH.PASSWORD_LABEL, { exact: false });
    expect(email).toMatchObject({ type: 'email', autocomplete: 'email', required: true });
    expect(password).toMatchObject({
      type: 'password',
      autocomplete: 'current-password',
      required: true,
    });
    expect(screen.queryByLabelText(COPY.AUTH.NAME_LABEL, { exact: false })).toBeNull();
  });

  it('links to /register', async () => {
    const { router } = renderAppAt(ROUTES.APP.LOGIN, signedOut);

    fireEvent.click(await screen.findByRole('link', { name: COPY.AUTH.LOGIN_SWITCH_LINK }));

    expect(await screen.findByRole('heading', { name: COPY.AUTH.REGISTER_TITLE })).toBeTruthy();
    expect(router.state.location.pathname).toBe(ROUTES.APP.REGISTER);
  });
});

describe('/register', () => {
  it('signs up through authClient with name, then lands on /map once Better Auth has the session', async () => {
    auth.signUpEmail.mockResolvedValue(ok({ token: 'tok_1', user: ada }));
    const { router } = renderAppAt(ROUTES.APP.REGISTER, signedOut);
    await screen.findByRole('heading', { name: COPY.AUTH.REGISTER_TITLE });

    fill(COPY.AUTH.NAME_LABEL, 'Ada Lovelace');
    fill(COPY.AUTH.EMAIL_LABEL, 'ada@example.com');
    fill(COPY.AUTH.PASSWORD_LABEL, 'correct horse');
    fireEvent.click(screen.getByRole('button', { name: COPY.AUTH.REGISTER_SUBMIT }));

    await waitFor(() =>
      expect(auth.signUpEmail).toHaveBeenCalledWith({
        email: 'ada@example.com',
        password: 'correct horse',
        name: 'Ada Lovelace',
      }),
    );
    await betterAuthRefetch(signedIn.data);

    expect(await screen.findByTestId('map-root')).toBeTruthy();
    expect(router.state.location.pathname).toBe(ROUTES.APP.MAP);
  });

  it('asks for a new password of at least LIMITS.PASSWORD_MIN characters', async () => {
    renderAppAt(ROUTES.APP.REGISTER, signedOut);
    await screen.findByRole('heading', { name: COPY.AUTH.REGISTER_TITLE });

    const password = screen.getByLabelText(COPY.AUTH.PASSWORD_LABEL, { exact: false });
    expect(password).toMatchObject({
      type: 'password',
      autocomplete: 'new-password',
      minLength: LIMITS.PASSWORD_MIN,
      required: true,
    });
    expect(screen.getByText(COPY.AUTH.PASSWORD_HINT)).toBeTruthy();
    expect(screen.getByLabelText(COPY.AUTH.NAME_LABEL, { exact: false })).toMatchObject({
      autocomplete: 'name',
      required: true,
    });
  });

  it('links to /login', async () => {
    const { router } = renderAppAt(ROUTES.APP.REGISTER, signedOut);

    fireEvent.click(await screen.findByRole('link', { name: COPY.AUTH.REGISTER_SWITCH_LINK }));

    expect(await screen.findByRole('heading', { name: COPY.AUTH.LOGIN_TITLE })).toBeTruthy();
    expect(router.state.location.pathname).toBe(ROUTES.APP.LOGIN);
  });
});

describe('signed-in visitor', () => {
  it.each([ROUTES.APP.LOGIN, ROUTES.APP.REGISTER])('on %s lands on /map', async (path) => {
    const { router } = renderAppAt(path, signedIn);

    expect(await screen.findByTestId('map-root')).toBeTruthy();
    expect(router.state.location.pathname).toBe(ROUTES.APP.MAP);
    expect(screen.queryByRole('heading', { name: COPY.AUTH.LOGIN_TITLE })).toBeNull();
    expect(screen.queryByRole('heading', { name: COPY.AUTH.REGISTER_TITLE })).toBeNull();
  });
});

describe('sign-out', () => {
  it('calls authClient.signOut, then lands on /login once Better Auth drops the session', async () => {
    auth.signOut.mockResolvedValue(ok({ success: true }));
    const { router } = renderAppAt(ROUTES.APP.MAP, signedIn);
    await screen.findByTestId('map-root');

    fireEvent.click(screen.getByRole('button', { name: COPY.AUTH.SIGN_OUT }));

    await waitFor(() => expect(auth.signOut).toHaveBeenCalledTimes(1));
    await betterAuthRefetch(null);

    expect(await screen.findByRole('heading', { name: COPY.AUTH.LOGIN_TITLE })).toBeTruthy();
    expect(router.state.location.pathname).toBe(ROUTES.APP.LOGIN);
    expect(screen.queryByText(ada.name)).toBeNull();
  });

  it('keeps the user on /map with an alert when sign-out fails', async () => {
    auth.signOut.mockResolvedValue(failed(500, 'Internal Server Error'));
    const { router } = renderAppAt(ROUTES.APP.MAP, signedIn);
    await screen.findByTestId('map-root');

    fireEvent.click(screen.getByRole('button', { name: COPY.AUTH.SIGN_OUT }));

    expect((await screen.findByRole('alert')).textContent).toContain(COPY.AUTH.SIGN_OUT_ERROR);
    expect(router.state.location.pathname).toBe(ROUTES.APP.MAP);
    expect(screen.getByText(ada.name)).toBeTruthy();
  });
});
