// Parses src/styles/tokens.css so the Foundations pages render from the token file itself;
// styles/tokens.test.ts checks the file with the same parser.
import tokensCss from '../styles/tokens.css?raw';

export interface Token {
  name: string;
  value: string;
  /** Trailing comment on the declaration line, if any. */
  note: string | undefined;
}

const DECLARATION = /^\s*(--[\w-]+(?:-\*)?):\s*([^;]+);\s*(?:\/\*\s*(.*?)\s*\*\/)?/;

/** Every `--name: value;` line of `css` in order (its trailing comment as `note`), resets included. */
export function parseTokens(css: string): Token[] {
  return css.split('\n').flatMap((line) => {
    const match = DECLARATION.exec(line);
    return match ? [{ name: match[1]!, value: match[2]!.trim(), note: match[3] }] : [];
  });
}

/** The declarations that set a value (`initial` only resets a Tailwind default). */
const parse = (css: string) => parseTokens(css).filter((token) => token.value !== 'initial');

const darkStart = tokensCss.indexOf('@variant dark {');
const themeEnd = tokensCss.indexOf('@layer base');

/** Declarations in the @theme block (light / theme-independent values), in file order. */
export const themeTokens = parse(tokensCss.slice(0, themeEnd));

/** Dark-theme overrides by token name. */
export const darkTokens = new Map(
  parse(tokensCss.slice(darkStart)).map((token) => [token.name, token.value]),
);

/** Theme tokens whose name matches. */
export function tokens(pattern: RegExp): Token[] {
  return themeTokens.filter((token) => pattern.test(token.name));
}

/** "0.25rem" -> "4px"; other values unchanged. */
export function toPx(value: string): string {
  const rem = /^(-?\d*\.?\d+)rem$/.exec(value);
  return rem ? `${Number(rem[1]) * 16}px` : value;
}
