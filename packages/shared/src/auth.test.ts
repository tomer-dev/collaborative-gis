import { describe, expect, it } from 'vitest';
import { GetSessionResponseSchema } from './index';

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
