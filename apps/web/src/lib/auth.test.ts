import { COPY } from '@cgis/shared/constants';
import { describe, expect, it } from 'vitest';
import { authErrorMessage } from './auth';

describe('authErrorMessage', () => {
  it("is the server's message from a failed Better Auth call", () => {
    const failure = { status: 422, statusText: '', error: { message: 'User already exists' } };
    expect(authErrorMessage(failure)).toBe('User already exists');
  });

  it('is the generic copy for anything else', () => {
    expect(authErrorMessage(new TypeError('Failed to fetch'))).toBe(COPY.AUTH.ERROR_GENERIC);
    expect(authErrorMessage({ status: 502, statusText: 'Bad Gateway', error: '' })).toBe(
      COPY.AUTH.ERROR_GENERIC,
    );
    expect(authErrorMessage(null)).toBe(COPY.AUTH.ERROR_GENERIC);
  });
});
