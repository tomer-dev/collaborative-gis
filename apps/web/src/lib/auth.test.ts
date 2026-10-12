import { COPY } from '@cgis/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from './api';
import { authErrorMessage, signIn, signOut, signUp } from './auth';

// Better Auth's user object as sign-up and sign-in return it; the app keeps id and name.
const betterAuthUser = {
  id: 'user_1',
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  emailVerified: false,
  image: null,
  createdAt: '2026-10-12T00:00:00.000Z',
  updatedAt: '2026-10-12T00:00:00.000Z',
};

function stubFetch(response: () => Promise<Response>) {
  const fetchMock = vi.fn(response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function postInit(body: unknown) {
  return {
    method: 'POST',
    credentials: 'same-origin',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('signIn', () => {
  it('POSTs email and password to /api/auth/sign-in/email and resolves to { id, name }', async () => {
    const fetchMock = stubFetch(async () =>
      Response.json({ redirect: false, token: 'tok_1', user: betterAuthUser }),
    );

    await expect(signIn({ email: 'ada@example.com', password: 'correct horse' })).resolves.toEqual({
      id: 'user_1',
      name: 'Ada Lovelace',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/sign-in/email',
      postInit({ email: 'ada@example.com', password: 'correct horse' }),
    );
  });

  it('rejects a 401 with an ApiRequestError carrying the server message', async () => {
    stubFetch(async () =>
      Response.json(
        { code: 'INVALID_EMAIL_OR_PASSWORD', message: 'Invalid email or password' },
        { status: 401 },
      ),
    );

    const error = await signIn({ email: 'ada@example.com', password: 'wrong' }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error).toMatchObject({
      status: 401,
      message: 'Invalid email or password',
      body: { code: 'INVALID_EMAIL_OR_PASSWORD', message: 'Invalid email or password' },
    });
  });
});

describe('signUp', () => {
  it('POSTs name, email and password to /api/auth/sign-up/email and resolves to { id, name }', async () => {
    const fetchMock = stubFetch(async () =>
      Response.json({ token: 'tok_1', user: betterAuthUser }),
    );
    const input = { email: 'ada@example.com', password: 'correct horse', name: 'Ada Lovelace' };

    await expect(signUp(input)).resolves.toEqual({ id: 'user_1', name: 'Ada Lovelace' });
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/sign-up/email', postInit(input));
  });
});

describe('signOut', () => {
  it('POSTs to /api/auth/sign-out', async () => {
    const fetchMock = stubFetch(async () => Response.json({ success: true }));

    await expect(signOut()).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/sign-out', postInit({}));
  });

  it('rejects when the server refuses', async () => {
    stubFetch(async () =>
      Response.json(
        { code: 'FAILED_TO_GET_SESSION', message: 'Failed to get session' },
        { status: 400 },
      ),
    );

    await expect(signOut()).rejects.toBeInstanceOf(ApiRequestError);
  });
});

describe('authErrorMessage', () => {
  it("is the server's message when the response carried an ApiError body", () => {
    const error = new ApiRequestError(422, {
      code: 'USER_ALREADY_EXISTS',
      message: 'User already exists',
    });
    expect(authErrorMessage(error)).toBe('User already exists');
  });

  it('is the generic copy for a response without an ApiError body', () => {
    expect(authErrorMessage(new ApiRequestError(502, null))).toBe(COPY.AUTH.ERROR_GENERIC);
  });

  it('is the generic copy for anything else (network failure, malformed body)', () => {
    expect(authErrorMessage(new TypeError('Failed to fetch'))).toBe(COPY.AUTH.ERROR_GENERIC);
    expect(authErrorMessage(null)).toBe(COPY.AUTH.ERROR_GENERIC);
  });
});
