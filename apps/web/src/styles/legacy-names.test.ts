/// <reference types="node" />
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// The pre-Grid 4 theme (paper / ink / signal / graticule) was renamed to the tokens in tokens.css:
// bg-paper -> bg-bg, text-ink -> text-fg, text-ink-muted -> text-fg-muted, signal -> accent,
// --color-paper -> --color-bg, --color-signal -> --color-accent. This test keeps the old names out.
// The patterns are assembled from parts so this file does not match itself.
const OLD = ['paper', 'ink', 'signal', 'graticule'].join('|');
const UTILITY_PREFIXES = [
  'bg',
  'text',
  'border',
  'ring',
  'outline',
  'fill',
  'stroke',
  'decoration',
  'divide',
  'shadow',
  'caret',
  'accent',
  'from',
  'via',
  'to',
].join('|');
const LEGACY = [
  new RegExp(`\\b(${UTILITY_PREFIXES})-(${OLD})(-muted)?\\b`),
  new RegExp(`--color-(${OLD})\\b`),
  new RegExp(`\\b${'grati'}cule\\b`),
];

const SRC = join(import.meta.dirname, '..');
const SELF = join(import.meta.dirname, 'legacy-names.test.ts');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(tsx?|css)$/.test(entry.name) && path !== SELF ? [path] : [];
  });
}

describe('legacy theme names', () => {
  it('no file in apps/web/src uses bg-paper, text-ink, signal, graticule or their CSS variables', () => {
    const hits = sourceFiles(SRC).flatMap((file) =>
      readFileSync(file, 'utf8')
        .split('\n')
        .flatMap((line, index) =>
          LEGACY.some((pattern) => pattern.test(line))
            ? [`${relative(SRC, file)}:${index + 1}: ${line.trim()}`]
            : [],
        ),
    );
    expect(hits).toEqual([]);
  });
});
