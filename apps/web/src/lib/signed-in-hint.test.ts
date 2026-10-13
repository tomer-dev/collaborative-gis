import { AUTH } from '@cgis/shared/constants';
import { afterEach, expect, it, vi } from 'vitest';
import { readSignedInHint, writeSignedInHint } from './signed-in-hint';

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

it('remembers a signed-in browser under the constants key and forgets it on sign-out', () => {
  expect(readSignedInHint()).toBe(false);
  writeSignedInHint(true);
  expect(localStorage.getItem(AUTH.SIGNED_IN_HINT_KEY)).toBe(AUTH.SIGNED_IN_HINT_VALUE);
  expect(readSignedInHint()).toBe(true);
  writeSignedInHint(false);
  expect(localStorage.getItem(AUTH.SIGNED_IN_HINT_KEY)).toBeNull();
  expect(readSignedInHint()).toBe(false);
});

it('treats blocked storage (private mode) as nothing remembered', () => {
  const blocked = {
    getItem: () => {
      throw new Error('SecurityError');
    },
    setItem: () => {
      throw new Error('SecurityError');
    },
    removeItem: () => {
      throw new Error('SecurityError');
    },
  };
  vi.stubGlobal('localStorage', blocked);
  expect(() => writeSignedInHint(true)).not.toThrow();
  expect(() => writeSignedInHint(false)).not.toThrow();
  expect(readSignedInHint()).toBe(false);
});
