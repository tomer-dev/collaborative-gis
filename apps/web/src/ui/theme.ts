/** Class on <html> that switches the semantic tokens to their dark values (tokens.css). */
export const DARK_CLASS = 'dark';

/**
 * Follows the OS colour scheme by toggling DARK_CLASS on `root` now and on every change.
 * Returns a cleanup that stops listening. Call once at startup (main.tsx).
 */
export function syncColorScheme(root: HTMLElement = document.documentElement): () => void {
  const query = window.matchMedia('(prefers-color-scheme: dark)');
  const apply = () => root.classList.toggle(DARK_CLASS, query.matches);
  apply();
  query.addEventListener('change', apply);
  return () => query.removeEventListener('change', apply);
}
