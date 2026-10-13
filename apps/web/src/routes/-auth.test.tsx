// The leading '-' keeps the TanStack Router generator from treating this file as a route.
import { AUTH, COPY, LIMITS, ROUTES } from '@cgis/shared/constants';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory } from '@tanstack/react-router';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
// The client throws on an error answer (fetchOptions.throw): a BetterFetchError with the body.
const failed = (status: number, message?: string) =>
  Object.assign(new Error(String(status)), { status, error: message ? { message } : {} });

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
  // Every path the history moves to, even one whose route never finishes loading.
  const visited: string[] = [];
  router.history.subscribe(({ location }) => visited.push(location.pathname));
  render(
    <QueryClientProvider client={queryClient}>
      <AppRouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router, resolved, visited };
}

function fill(label: string, value: string) {
  // Labels end in an aria-hidden " *" for required fields, so match on the label's start.
  fireEvent.change(screen.getByLabelText(label, { exact: false }), { target: { value } });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
  localStorage.clear();
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
    auth.signInEmail.mockResolvedValue({ redirect: false, token: 'tok_1', user: ada });
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
    auth.signInEmail.mockRejectedValue(failed(401, 'Invalid email or password'));
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
    // Focus goes back to the form's first field, not to the page.
    expect(document.activeElement).toBe(
      screen.getByRole('textbox', { name: COPY.AUTH.EMAIL_LABEL }),
    );
  });

  it('shows the generic copy when the failure carries no message', async () => {
    auth.signInEmail.mockRejectedValue(failed(502));
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

    await act(async () => respond({ redirect: false, token: 'tok_1', user: ada }));
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
    auth.signUpEmail.mockResolvedValue({ token: 'tok_1', user: ada });
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
      maxLength: LIMITS.USER_NAME_MAX,
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

describe('cold load', () => {
  // The real get-session takes a round trip; give the router time to act while it is pending.
  const sessionRoundTrip = () => act(() => new Promise((resolve) => setTimeout(resolve, 100)));

  it('signed in: never goes to /login while the first session check is pending', async () => {
    const { router, resolved, visited } = renderAppAt(ROUTES.APP.MAP, {
      data: null,
      isPending: true,
    });
    await sessionRoundTrip();
    await act(async () => auth.set(signedIn));

    await waitFor(() => expect(resolved).toContain(ROUTES.APP.MAP));
    // The _authed guard never ran against the unknown session, so it never redirected.
    expect(visited).not.toContain(ROUTES.APP.LOGIN);
    expect(resolved).toEqual([ROUTES.APP.MAP]);
    expect(router.state.location.pathname).toBe(ROUTES.APP.MAP);
  });

  it('signed out, nothing remembered: shows the status, then lands on /login with a single redirect', async () => {
    const { router, resolved, visited } = renderAppAt(ROUTES.APP.MAP, {
      data: null,
      isPending: true,
    });
    expect(screen.getByRole('status').textContent).toBe(COPY.AUTH.SESSION_CHECKING);
    expect(screen.queryByRole('heading', { name: COPY.APP.NAME })).toBeNull();
    await sessionRoundTrip();
    await act(async () => auth.set(signedOut));

    await waitFor(() => expect(resolved).toContain(ROUTES.APP.LOGIN));
    expect(screen.getByRole('heading', { name: COPY.AUTH.LOGIN_TITLE })).toBeTruthy();
    expect(visited).toEqual([ROUTES.APP.LOGIN]);
    expect(resolved).toEqual([ROUTES.APP.LOGIN]);
    expect(router.state.location.pathname).toBe(ROUTES.APP.LOGIN);
  });

  it('remembers a signed-in browser and forgets a signed-out one', async () => {
    renderAppAt(ROUTES.APP.MAP, { data: null, isPending: true });
    await act(async () => auth.set(signedIn));
    expect(localStorage.getItem(AUTH.SIGNED_IN_HINT_KEY)).toBe(AUTH.SIGNED_IN_HINT_VALUE);

    await act(async () => auth.set(signedOut));
    expect(localStorage.getItem(AUTH.SIGNED_IN_HINT_KEY)).toBeNull();
  });

  it('remembered as signed in: shows the app frame at once instead of the status, then the map', async () => {
    localStorage.setItem(AUTH.SIGNED_IN_HINT_KEY, AUTH.SIGNED_IN_HINT_VALUE);
    // Every commit, not just the settled states: the app name must never leave the DOM once there.
    let h1Gone = 0;
    const observer = new MutationObserver(() => {
      if (!document.querySelector('h1')) h1Gone += 1;
    });
    observer.observe(document.body, { childList: true, subtree: true });
    const { router, resolved, visited } = renderAppAt(ROUTES.APP.MAP, {
      data: null,
      isPending: true,
    });
    expect(screen.getByRole('heading', { name: COPY.APP.NAME })).toBeTruthy();
    // The gap is the session round trip: a map-coloured surface, not the page background.
    expect(screen.getByRole('main').className).toContain('bg-map-bg');
    expect(screen.getByRole('link', { name: COPY.APP.GUIDE }).getAttribute('href')).toBe(
      ROUTES.APP.GUIDE,
    );
    // Still announced to a screen reader, just not shown.
    expect(screen.getByRole('status').textContent).toBe(COPY.AUTH.SESSION_CHECKING);
    expect(screen.queryByTestId('map-root')).toBeNull();
    expect(resolved).toEqual([]);
    await sessionRoundTrip();
    await act(async () => auth.set(signedIn));

    // The hand-off never blanks the screen: the frame is there the moment the router takes over.
    expect(screen.getByRole('heading', { name: COPY.APP.NAME })).toBeTruthy();
    expect(await screen.findByTestId('map-root')).toBeTruthy();
    observer.disconnect();
    expect(h1Gone).toBe(0);
    expect(visited).not.toContain(ROUTES.APP.LOGIN);
    expect(resolved).toEqual([ROUTES.APP.MAP]);
    expect(router.state.location.pathname).toBe(ROUTES.APP.MAP);
  });

  it('remembered as signed in but the session ended: one redirect to /login and the hint is cleared', async () => {
    localStorage.setItem(AUTH.SIGNED_IN_HINT_KEY, AUTH.SIGNED_IN_HINT_VALUE);
    const { router, resolved, visited } = renderAppAt(ROUTES.APP.MAP, {
      data: null,
      isPending: true,
    });
    expect(screen.getByRole('heading', { name: COPY.APP.NAME })).toBeTruthy();
    await sessionRoundTrip();
    await act(async () => auth.set(signedOut));

    await screen.findByRole('heading', { name: COPY.AUTH.LOGIN_TITLE });
    expect(visited).toEqual([ROUTES.APP.LOGIN]);
    expect(resolved).toEqual([ROUTES.APP.LOGIN]);
    expect(router.state.location.pathname).toBe(ROUTES.APP.LOGIN);
    expect(localStorage.getItem(AUTH.SIGNED_IN_HINT_KEY)).toBeNull();
  });
});

describe('index.html', () => {
  it('carries the pre-mount skeleton with the app name, for the first paint before React', () => {
    const html = readFileSync(join(import.meta.dirname, '../../index.html'), 'utf8');
    expect(html).toContain(`<header>${COPY.APP.NAME}</header>`);
  });
});

describe('sign-out', () => {
  it('calls authClient.signOut, then lands on /login once Better Auth drops the session', async () => {
    auth.signOut.mockResolvedValue({ success: true });
    const { router } = renderAppAt(ROUTES.APP.MAP, signedIn);
    await screen.findByTestId('map-root');

    fireEvent.click(screen.getByRole('button', { name: COPY.AUTH.SIGN_OUT }));

    await waitFor(() => expect(auth.signOut).toHaveBeenCalledTimes(1));
    await betterAuthRefetch(null);

    expect(await screen.findByRole('heading', { name: COPY.AUTH.LOGIN_TITLE })).toBeTruthy();
    expect(router.state.location.pathname).toBe(ROUTES.APP.LOGIN);
    expect(screen.queryByText(ada.name)).toBeNull();
  });

  it('sign in, sign out, sign in again in one tab: the guards re-run each time', async () => {
    auth.signInEmail.mockResolvedValue({ redirect: false, token: 'tok_1', user: ada });
    auth.signOut.mockResolvedValue({ success: true });
    const { router } = renderAppAt(ROUTES.APP.LOGIN, signedOut);
    const signIn = async () => {
      await screen.findByRole('heading', { name: COPY.AUTH.LOGIN_TITLE });
      fill(COPY.AUTH.EMAIL_LABEL, 'ada@example.com');
      fill(COPY.AUTH.PASSWORD_LABEL, 'correct horse');
      fireEvent.click(screen.getByRole('button', { name: COPY.AUTH.LOGIN_SUBMIT }));
      await waitFor(() => expect(auth.signInEmail).toHaveBeenCalled());
      await betterAuthRefetch(signedIn.data);
      await screen.findByTestId('map-root');
      expect(router.state.location.pathname).toBe(ROUTES.APP.MAP);
    };

    await signIn();
    fireEvent.click(screen.getByRole('button', { name: COPY.AUTH.SIGN_OUT }));
    await betterAuthRefetch(null);
    await screen.findByRole('heading', { name: COPY.AUTH.LOGIN_TITLE });
    expect(router.state.location.pathname).toBe(ROUTES.APP.LOGIN);
    await signIn();
  });

  it('keeps the user on /map with an alert when sign-out fails', async () => {
    auth.signOut.mockRejectedValue(failed(500, 'Internal Server Error'));
    const { router } = renderAppAt(ROUTES.APP.MAP, signedIn);
    await screen.findByTestId('map-root');

    fireEvent.click(screen.getByRole('button', { name: COPY.AUTH.SIGN_OUT }));

    expect((await screen.findByRole('alert')).textContent).toContain(COPY.AUTH.SIGN_OUT_ERROR);
    expect(router.state.location.pathname).toBe(ROUTES.APP.MAP);
    expect(screen.getByText(ada.name)).toBeTruthy();
  });
});
