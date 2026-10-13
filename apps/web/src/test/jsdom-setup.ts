// Vitest setup (vite.config.ts `test.setupFiles`): what jsdom lacks and every test may reach.

// No matchMedia in jsdom: a media query matches nothing (no reduced motion, any width) unless a
// test stubs `matchMedia` itself.
if (typeof window.matchMedia !== 'function') {
  window.matchMedia = (media) => ({
    media,
    matches: false,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}
