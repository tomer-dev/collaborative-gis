import { describe, expect, it } from 'vitest';
import {
  GetSessionResponseSchema,
  LIMITS,
  SignInRequestSchema,
  SignInResponseSchema,
  SignOutResponseSchema,
  SignUpRequestSchema,
  SignUpResponseSchema,
} from './index';

// Better Auth's user object as sign-up, sign-in and get-session return it.
const betterAuthUser = {
  id: 'user_1',
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  emailVerified: false,
  image: null,
  createdAt: '2026-10-12T00:00:00.000Z',
  updatedAt: '2026-10-12T00:00:00.000Z',
};

describe('GetSessionResponseSchema', () => {
  it('keeps only user.id and user.name from a Better Auth session body', () => {
    const body = {
      session: { id: 'sess_1', userId: 'user_1', token: 'tok_1' },
      user: { id: 'user_1', name: 'Ada Lovelace', email: 'ada@example.com' },
    };
    expect(GetSessionResponseSchema.parse(body)).toEqual({
      user: { id: 'user_1', name: 'Ada Lovelace' },
    });
  });

  it('accepts null (signed out)', () => {
    expect(GetSessionResponseSchema.parse(null)).toBeNull();
  });

  it('rejects malformed bodies', () => {
    for (const body of [undefined, {}, { user: null }, { user: { id: 1, name: 'x' } }, 'null']) {
      expect(GetSessionResponseSchema.safeParse(body).success).toBe(false);
    }
  });
});

describe('SignUpRequestSchema', () => {
  const valid = { name: 'Ada Lovelace', email: 'ada@example.com', password: 'correct horse' };

  it('accepts name, email and a password of at least LIMITS.PASSWORD_MIN characters', () => {
    expect(SignUpRequestSchema.parse(valid)).toEqual(valid);
    const shortest = { ...valid, password: 'x'.repeat(LIMITS.PASSWORD_MIN) };
    expect(SignUpRequestSchema.safeParse(shortest).success).toBe(true);
  });

  it('rejects a short password, a bad email and an empty name', () => {
    for (const body of [
      { ...valid, password: 'x'.repeat(LIMITS.PASSWORD_MIN - 1) },
      { ...valid, email: 'not-an-email' },
      { ...valid, name: '' },
    ]) {
      expect(SignUpRequestSchema.safeParse(body).success).toBe(false);
    }
  });
});

describe('SignInRequestSchema', () => {
  it('accepts email and password', () => {
    const body = { email: 'ada@example.com', password: 'correct horse' };
    expect(SignInRequestSchema.parse(body)).toEqual(body);
  });

  it('rejects an empty password', () => {
    const body = { email: 'ada@example.com', password: '' };
    expect(SignInRequestSchema.safeParse(body).success).toBe(false);
  });
});

describe('sign-up and sign-in responses', () => {
  it('keep only user.id and user.name (the session token stays in the cookie)', () => {
    expect(SignUpResponseSchema.parse({ token: 'tok_1', user: betterAuthUser })).toEqual({
      user: { id: 'user_1', name: 'Ada Lovelace' },
    });
    expect(
      SignInResponseSchema.parse({ redirect: false, token: 'tok_1', user: betterAuthUser }),
    ).toEqual({ user: { id: 'user_1', name: 'Ada Lovelace' } });
  });

  it('reject a body without a user', () => {
    expect(SignInResponseSchema.safeParse({ token: 'tok_1' }).success).toBe(false);
    expect(SignUpResponseSchema.safeParse(null).success).toBe(false);
  });
});

describe('SignOutResponseSchema', () => {
  it('accepts { success: true }', () => {
    expect(SignOutResponseSchema.parse({ success: true })).toEqual({ success: true });
  });

  it('rejects a body without success', () => {
    expect(SignOutResponseSchema.safeParse({}).success).toBe(false);
  });
});
