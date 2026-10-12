// The leading '-' keeps the TanStack Router generator from treating this file as a route.
import { COPY, LIMITS, ROUTES } from '@cgis/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory } from '@tanstack/react-router';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sessionQuery, type SessionUser } from '../lib/session';
import { AppRouterProvider, createAppRouter } from '../router';

const ada: SessionUser = { id: 'user_1', name: 'Ada Lovelace' };
const betterAuthUser = {
  ...ada,
  email: 'ada@example.com',
  emailVerified: false,
  image: null,
  createdAt: '2026-10-12T00:00:00.000Z',
  updatedAt: '2026-10-12T00:00:00.000Z',
};
const signedIn = { session: { id: 'sess_1', userId: ada.id }, user: betterAuthUser };

type Handler = () => Response | Promise<Response>;

/** Stubs fetch with one handler per "METHOD path"; any other request rejects. */
function stubApi(handlers: Record<string, Handler>) {
  const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${input}`;
    const handler = handlers[key];
    if (!handler) throw new Error(`unexpected request: ${key}`);
    return handler();
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderAppAt(path: string, seededUser?: SessionUser) {
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
  if (seededUser) queryClient.setQueryData(sessionQuery.queryKey, seededUser);
  const router = createAppRouter(queryClient, createMemoryHistory({ initialEntries: [path] }));
  // Every path the router settles on, to prove a sign-in never passes back through /login.
  const resolved: string[] = [];
  router.subscribe('onResolved', (event) => resolved.push(event.toLocation.pathname));
  render(
    <QueryClientProvider client={queryClient}>
      <AppRouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { queryClient, router, resolved };
}

function fill(label: string, value: string) {
  // Labels end in an aria-hidden " *" for required fields, so match on the label's start.
  fireEvent.change(screen.getByLabelText(label, { exact: false }), { target: { value } });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('/login', () => {
  it('signs in, stores the user in the session query, then lands on /map', async () => {
    const fetchMock = stubApi({
      [`GET ${ROUTES.AUTH_GET_SESSION}`]: () => Response.json(null),
      [`POST ${ROUTES.AUTH_SIGN_IN}`]: () =>
        Response.json({ redirect: false, token: 'tok_1', user: betterAuthUser }),
    });
    const { queryClient, router, resolved } = renderAppAt('/login');
    await screen.findByRole('heading', { name: COPY.AUTH.LOGIN_TITLE });

    fill(COPY.AUTH.EMAIL_LABEL, 'ada@example.com');
    fill(COPY.AUTH.PASSWORD_LABEL, 'correct horse');
    fireEvent.click(screen.getByRole('button', { name: COPY.AUTH.LOGIN_SUBMIT }));

    expect(await screen.findByTestId('map-root')).toBeTruthy();
    expect(router.state.location.pathname).toBe('/map');
    expect(queryClient.getQueryData(sessionQuery.queryKey)).toEqual(ada);
    expect(fetchMock).toHaveBeenCalledWith(
      ROUTES.AUTH_SIGN_IN,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ email: 'ada@example.com', password: 'correct horse' }),
      }),
    );
    // /login, then straight to /map: the _authed guard never bounced the user back.
    expect(resolved).toEqual(['/login', '/map']);
    expect(screen.getByText(ada.name)).toBeTruthy();
  });

  it('shows the server message in an alert on a wrong password and stays on /login', async () => {
    stubApi({
      [`GET ${ROUTES.AUTH_GET_SESSION}`]: () => Response.json(null),
      [`POST ${ROUTES.AUTH_SIGN_IN}`]: () =>
        Response.json(
          { code: 'INVALID_EMAIL_OR_PASSWORD', message: 'Invalid email or password' },
          { status: 401 },
        ),
    });
    const { queryClient, router } = renderAppAt('/login');
    await screen.findByRole('heading', { name: COPY.AUTH.LOGIN_TITLE });

    fill(COPY.AUTH.EMAIL_LABEL, 'ada@example.com');
    fill(COPY.AUTH.PASSWORD_LABEL, 'wrong password');
    fireEvent.click(screen.getByRole('button', { name: COPY.AUTH.LOGIN_SUBMIT }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Invalid email or password');
    expect(alert.textContent).toContain(COPY.AUTH.LOGIN_ERROR_TITLE);
    expect(router.state.location.pathname).toBe('/login');
    expect(queryClient.getQueryData(sessionQuery.queryKey)).toBeNull();
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

  it('disables the submit button while the request is pending', async () => {
    let respond: (response: Response) => void = () => {};
    const pending = new Promise<Response>((resolve) => {
      respond = resolve;
    });
    stubApi({
      [`GET ${ROUTES.AUTH_GET_SESSION}`]: () => Response.json(null),
      [`POST ${ROUTES.AUTH_SIGN_IN}`]: () => pending,
    });
    const { router } = renderAppAt('/login');
    await screen.findByRole('heading', { name: COPY.AUTH.LOGIN_TITLE });

    fill(COPY.AUTH.EMAIL_LABEL, 'ada@example.com');
    fill(COPY.AUTH.PASSWORD_LABEL, 'correct horse');
    fireEvent.click(screen.getByRole('button', { name: COPY.AUTH.LOGIN_SUBMIT }));

    const busy = await screen.findByRole('button', { name: COPY.AUTH.LOGIN_PENDING });
    expect(busy).toHaveProperty('disabled', true);

    respond(Response.json({ redirect: false, token: 'tok_1', user: betterAuthUser }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/map'));
  });

  it('marks the fields required and uses sign-in autocomplete hints', async () => {
    stubApi({ [`GET ${ROUTES.AUTH_GET_SESSION}`]: () => Response.json(null) });
    renderAppAt('/login');
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
    stubApi({ [`GET ${ROUTES.AUTH_GET_SESSION}`]: () => Response.json(null) });
    const { router } = renderAppAt('/login');

    fireEvent.click(await screen.findByRole('link', { name: COPY.AUTH.LOGIN_SWITCH_LINK }));

    expect(await screen.findByRole('heading', { name: COPY.AUTH.REGISTER_TITLE })).toBeTruthy();
    expect(router.state.location.pathname).toBe('/register');
  });
});

describe('/register', () => {
  it('signs up with name, email and password, then lands on /map', async () => {
    const fetchMock = stubApi({
      [`GET ${ROUTES.AUTH_GET_SESSION}`]: () => Response.json(null),
      [`POST ${ROUTES.AUTH_SIGN_UP}`]: () =>
        Response.json({ token: 'tok_1', user: betterAuthUser }),
    });
    const { queryClient, router, resolved } = renderAppAt('/register');
    await screen.findByRole('heading', { name: COPY.AUTH.REGISTER_TITLE });

    fill(COPY.AUTH.NAME_LABEL, 'Ada Lovelace');
    fill(COPY.AUTH.EMAIL_LABEL, 'ada@example.com');
    fill(COPY.AUTH.PASSWORD_LABEL, 'correct horse');
    fireEvent.click(screen.getByRole('button', { name: COPY.AUTH.REGISTER_SUBMIT }));

    expect(await screen.findByTestId('map-root')).toBeTruthy();
    expect(router.state.location.pathname).toBe('/map');
    expect(queryClient.getQueryData(sessionQuery.queryKey)).toEqual(ada);
    expect(fetchMock).toHaveBeenCalledWith(
      ROUTES.AUTH_SIGN_UP,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          email: 'ada@example.com',
          password: 'correct horse',
          name: 'Ada Lovelace',
        }),
      }),
    );
    expect(resolved).toEqual(['/register', '/map']);
  });

  it('asks for a new password of at least LIMITS.PASSWORD_MIN characters', async () => {
    stubApi({ [`GET ${ROUTES.AUTH_GET_SESSION}`]: () => Response.json(null) });
    renderAppAt('/register');
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
    stubApi({ [`GET ${ROUTES.AUTH_GET_SESSION}`]: () => Response.json(null) });
    const { router } = renderAppAt('/register');

    fireEvent.click(await screen.findByRole('link', { name: COPY.AUTH.REGISTER_SWITCH_LINK }));

    expect(await screen.findByRole('heading', { name: COPY.AUTH.LOGIN_TITLE })).toBeTruthy();
    expect(router.state.location.pathname).toBe('/login');
  });
});

describe('signed-in visitor', () => {
  it.each(['/login', '/register'])('on %s lands on /map', async (path) => {
    stubApi({ [`GET ${ROUTES.AUTH_GET_SESSION}`]: () => Response.json(signedIn) });
    const { router } = renderAppAt(path, ada);

    expect(await screen.findByTestId('map-root')).toBeTruthy();
    expect(router.state.location.pathname).toBe('/map');
    expect(screen.queryByRole('heading', { name: COPY.AUTH.LOGIN_TITLE })).toBeNull();
    expect(screen.queryByRole('heading', { name: COPY.AUTH.REGISTER_TITLE })).toBeNull();
  });
});

describe('sign-out', () => {
  it('calls sign-out, clears the session and lands on /login', async () => {
    const fetchMock = stubApi({
      [`GET ${ROUTES.AUTH_GET_SESSION}`]: () => Response.json(signedIn),
      [`POST ${ROUTES.AUTH_SIGN_OUT}`]: () => Response.json({ success: true }),
    });
    const { queryClient, router } = renderAppAt('/map');
    await screen.findByTestId('map-root');

    fireEvent.click(screen.getByRole('button', { name: COPY.AUTH.SIGN_OUT }));

    expect(await screen.findByRole('heading', { name: COPY.AUTH.LOGIN_TITLE })).toBeTruthy();
    expect(router.state.location.pathname).toBe('/login');
    expect(queryClient.getQueryData(sessionQuery.queryKey)).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(
      ROUTES.AUTH_SIGN_OUT,
      expect.objectContaining({ method: 'POST' }),
    );
    expect(screen.queryByText(ada.name)).toBeNull();
  });

  it('keeps the user on /map with an alert when sign-out fails and the session is still valid', async () => {
    const fetchMock = stubApi({
      [`GET ${ROUTES.AUTH_GET_SESSION}`]: () => Response.json(signedIn),
      [`POST ${ROUTES.AUTH_SIGN_OUT}`]: () =>
        Response.json({ code: 'INTERNAL', message: 'Internal Server Error' }, { status: 500 }),
    });
    const { router } = renderAppAt('/map');
    await screen.findByTestId('map-root');

    fireEvent.click(screen.getByRole('button', { name: COPY.AUTH.SIGN_OUT }));

    expect((await screen.findByRole('alert')).textContent).toContain(COPY.AUTH.SIGN_OUT_ERROR);
    expect(router.state.location.pathname).toBe('/map');
    // The failure re-checked the session with the server.
    const sessionChecks = fetchMock.mock.calls.filter(([url]) => url === ROUTES.AUTH_GET_SESSION);
    expect(sessionChecks).toHaveLength(2);
  });

  it('lands on /login when sign-out fails because the session had already ended', async () => {
    const sessions: unknown[] = [signedIn, null];
    stubApi({
      [`GET ${ROUTES.AUTH_GET_SESSION}`]: () => Response.json(sessions.shift() ?? null),
      [`POST ${ROUTES.AUTH_SIGN_OUT}`]: () =>
        Response.json(
          { code: 'FAILED_TO_GET_SESSION', message: 'Failed to get session' },
          { status: 400 },
        ),
    });
    const { router } = renderAppAt('/map');
    await screen.findByTestId('map-root');

    fireEvent.click(screen.getByRole('button', { name: COPY.AUTH.SIGN_OUT }));

    expect(await screen.findByRole('heading', { name: COPY.AUTH.LOGIN_TITLE })).toBeTruthy();
    expect(router.state.location.pathname).toBe('/login');
  });
});
