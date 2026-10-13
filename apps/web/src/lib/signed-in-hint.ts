import { AUTH } from '@cgis/shared/constants';

/**
 * Whether this browser held a session the last time the app checked. A cold load uses it to
 * show the app frame instead of the session status while the first check runs; the guards
 * still act on the real answer. Storage that throws (private mode, blocked site data) counts
 * as nothing remembered.
 */
export function readSignedInHint(): boolean {
  try {
    return localStorage.getItem(AUTH.SIGNED_IN_HINT_KEY) === AUTH.SIGNED_IN_HINT_VALUE;
  } catch {
    return false;
  }
}

/** Records the latest session answer: set while a user is signed in, cleared once none is. */
export function writeSignedInHint(signedIn: boolean): void {
  try {
    if (signedIn) localStorage.setItem(AUTH.SIGNED_IN_HINT_KEY, AUTH.SIGNED_IN_HINT_VALUE);
    else localStorage.removeItem(AUTH.SIGNED_IN_HINT_KEY);
  } catch {
    // Nothing to remember in: the next cold load shows the status instead of the frame.
  }
}
