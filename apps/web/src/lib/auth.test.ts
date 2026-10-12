import { COPY } from '@cgis/shared/constants';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthError, authErrorMessage, signIn, signOut, signUp } from './auth';

const client = vi.hoisted(() => ({
  signInEmail: vi.fn(),
  signUpEmail: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock('./auth-client', () => ({
  authClient: {
    signIn: { email: client.signInEmail },
    signUp: { email: client.signUpEmail },
    signOut: client.signOut,
  },
}));

// Better Auth's `{ data, error }` results as the client resolves them.
const ok = (data: unknown) => ({ data, error: null });
const failed = (status: number, statusText: string, body: { code?: string; message?: string }) => ({
  data: null,
  error: { status, statusText, ...body },
});

const user = { id: 'user_1', name: 'Ada Lovelace', email: 'ada@example.com' };

afterEach(() => {
  vi.resetAllMocks();
});

describe('signIn', () => {
  it('calls authClient.signIn.email with email and password', async () => {
    client.signInEmail.mockResolvedValue(ok({ redirect: false, token: 'tok_1', user }));

    await expect(
      signIn({ email: 'ada@example.com', password: 'correct horse' }),
    ).resolves.toBeUndefined();
    expect(client.signInEmail).toHaveBeenCalledWith({
      email: 'ada@example.com',
      password: 'correct horse',
    });
  });

  it('rejects a 401 with an AuthError carrying the server message', async () => {
    client.signInEmail.mockResolvedValue(
      failed(401, 'Unauthorized', {
        code: 'INVALID_EMAIL_OR_PASSWORD',
        message: 'Invalid email or password',
      }),
    );

    const error = await signIn({ email: 'ada@example.com', password: 'wrong' }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(AuthError);
    expect(error).toMatchObject({ status: 401, message: 'Invalid email or password' });
  });

  it('rejects with the generic copy when the error carries no message', async () => {
    client.signInEmail.mockResolvedValue(failed(502, 'Bad Gateway', {}));

    await expect(signIn({ email: 'ada@example.com', password: 'x' })).rejects.toMatchObject({
      status: 502,
      message: COPY.AUTH.ERROR_GENERIC,
    });
  });
});

describe('signUp', () => {
  it('calls authClient.signUp.email with email, password and name', async () => {
    client.signUpEmail.mockResolvedValue(ok({ token: 'tok_1', user }));
    const input = { email: 'ada@example.com', password: 'correct horse', name: 'Ada Lovelace' };

    await expect(signUp(input)).resolves.toBeUndefined();
    expect(client.signUpEmail).toHaveBeenCalledWith(input);
  });

  it('rejects with the server message when the email is taken', async () => {
    client.signUpEmail.mockResolvedValue(
      failed(422, 'Unprocessable Entity', {
        code: 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL',
        message: 'User already exists. Use another email.',
      }),
    );

    await expect(
      signUp({ email: 'ada@example.com', password: 'correct horse', name: 'Ada' }),
    ).rejects.toMatchObject({ status: 422, message: 'User already exists. Use another email.' });
  });
});

describe('signOut', () => {
  it('calls authClient.signOut', async () => {
    client.signOut.mockResolvedValue(ok({ success: true }));

    await expect(signOut()).resolves.toBeUndefined();
    expect(client.signOut).toHaveBeenCalledTimes(1);
  });

  it('rejects when the server refuses', async () => {
    client.signOut.mockResolvedValue(failed(500, 'Internal Server Error', {}));

    await expect(signOut()).rejects.toBeInstanceOf(AuthError);
  });
});

describe('authErrorMessage', () => {
  it("is an AuthError's message", () => {
    expect(authErrorMessage(new AuthError(422, 'User already exists'))).toBe('User already exists');
  });

  it('is the generic copy for anything else (network failure, thrown by the client)', () => {
    expect(authErrorMessage(new TypeError('Failed to fetch'))).toBe(COPY.AUTH.ERROR_GENERIC);
    expect(authErrorMessage(null)).toBe(COPY.AUTH.ERROR_GENERIC);
  });
});
