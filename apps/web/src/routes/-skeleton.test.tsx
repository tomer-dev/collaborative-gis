// The leading '-' keeps the TanStack Router generator from treating this file as a route.
import { AUTH, COPY } from '@cgis/shared/constants';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('index.html', () => {
  const html = readFileSync(join(import.meta.dirname, '../../index.html'), 'utf8');
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const header = doc.querySelector('#root > #skeleton > header');

  it('carries the pre-mount skeleton with the app name, for the first paint before React', () => {
    // Inside #root, so React replaces it on mount instead of leaving a second header.
    expect(header?.firstElementChild?.textContent).toBe(COPY.APP.NAME);
  });

  it('draws the top bar end as AppFrame will: the Guide button and the session menu box', () => {
    expect(header?.querySelector('.guide')?.textContent).toBe(COPY.APP.GUIDE);
    expect(header?.querySelector('.session .button')?.textContent).toBe(COPY.AUTH.SIGN_OUT);
    // The session box shows only for a browser remembered as signed in: the hint, read inline.
    const script = doc.querySelector('#skeleton + script')?.textContent ?? '';
    expect(script).toContain(`localStorage.getItem('${AUTH.SIGNED_IN_HINT_KEY}')`);
    expect(script).toContain(`=== '${AUTH.SIGNED_IN_HINT_VALUE}'`);
  });

  // The inline script's free `document` and `localStorage` bind to the parsed page and a stub.
  const runScript = (storage: Pick<Storage, 'getItem'>) =>
    new Function('document', 'localStorage', doc.querySelector('#skeleton + script')!.textContent)(
      doc,
      storage,
    );
  const skeleton = () => doc.querySelector('#skeleton')!;

  it('marks the skeleton remembered from the hint, and never throws on blocked storage', () => {
    runScript({ getItem: () => null });
    expect(skeleton().hasAttribute('data-remembered')).toBe(false);
    runScript({ getItem: () => AUTH.SIGNED_IN_HINT_VALUE });
    expect(skeleton().hasAttribute('data-remembered')).toBe(true);
    skeleton().removeAttribute('data-remembered');
    expect(() =>
      runScript({
        getItem: () => {
          throw new Error('blocked');
        },
      }),
    ).not.toThrow();
    expect(skeleton().hasAttribute('data-remembered')).toBe(false);
  });
});
