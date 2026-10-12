/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MAP } from '@cgis/shared';
import { describe, expect, it } from 'vitest';

// Read from disk: Vitest stubs CSS imports (even `?raw`) to empty strings.
const tokensCss = readFileSync(join(import.meta.dirname, 'tokens.css'), 'utf8');

/** `--name: value;` declarations in source order, with the line each one sits on. */
function declarations(css: string) {
  return css.split('\n').flatMap((line) => {
    const match = /^\s*(--[\w-]+(?:-\*)?):\s*([^;]+);/.exec(line);
    return match ? [{ name: match[1]!, value: match[2]!.trim(), line }] : [];
  });
}

const decls = declarations(tokensCss);
const themeValue = (name: string) => decls.find((d) => d.name === name)?.value;

describe('tokens.css', () => {
  it('resets Tailwind defaults so only Grid 4 tokens generate utilities', () => {
    for (const reset of ['--color-*', '--spacing', '--font-*', '--text-*', '--radius-*']) {
      expect(themeValue(reset), reset).toBe('initial');
    }
  });

  it('defines exactly the Grid 4 spacing steps (x 4 px)', () => {
    const steps = decls
      .filter((d) => /^--spacing-\d+$/.test(d.name))
      .map((d) => [Number(d.name.slice('--spacing-'.length)), parseFloat(d.value) * 16]);
    expect(steps.map(([step]) => step)).toEqual([0, 1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24]);
    for (const [step, px] of steps) expect(px, `--spacing-${step}`).toBe(step! * 4);
  });

  it('keeps every length on the 4 px grid unless the line documents a grid-exception', () => {
    const offGrid = decls.flatMap((d) => {
      if (d.line.includes('grid-exception:')) return [];
      const lengths = [...d.value.matchAll(/(-?\d*\.?\d+)(px|rem)\b/g)].map(([, n, unit]) =>
        unit === 'rem' ? Number(n) * 16 : Number(n),
      );
      return lengths.filter((px) => px % 4 !== 0).map((px) => `${d.name}: ${px}px`);
    });
    expect(offGrid).toEqual([]);
  });

  it('defines six type sizes with line-heights on the grid', () => {
    for (const size of ['xs', 'sm', 'md', 'lg', 'xl', '2xl']) {
      const lineHeight = themeValue(`--text-${size}--line-height`);
      expect(lineHeight, size).toMatch(/rem$/);
      expect((parseFloat(lineHeight!) * 16) % 4, size).toBe(0);
    }
  });

  it('mirrors the map pane z-indexes from MAP', () => {
    expect(Number(themeValue('--z-index-map-areas'))).toBe(MAP.AREAS_PANE_Z);
    expect(Number(themeValue('--z-index-map-drafts'))).toBe(MAP.DRAFTS_PANE_Z);
  });

  it('owns the vertex handle look in CSS and leaves the Leaflet JS numbers to MAP', () => {
    // CSS source: the handle dot (radius, ring, colours) for .cgis-draw-handle in map.css.
    for (const name of ['--map-handle-radius', '--map-handle-border', '--map-handle-ring']) {
      expect(themeValue(name), name).toBeDefined();
    }
    // JS source (MAP): the marker hit box and the sketch path options; no CSS copy of them.
    const duplicated = decls.filter((d) =>
      /^--map-(handle-hit|draft-(dash|stroke-width|fill-opacity))/.test(d.name),
    );
    expect(duplicated.map((d) => d.name)).toEqual([]);
    expect(MAP.DRAFT_STYLE.dashArray).toBe('8 4');
  });

  it('gives every themed semantic colour a dark value', () => {
    const darkBlock = tokensCss.slice(tokensCss.indexOf('@variant dark {'));
    const darkNames = new Set(declarations(darkBlock).map((d) => d.name));
    for (const name of [
      '--color-bg',
      '--color-bg-raised',
      '--color-bg-sunken',
      '--color-fg',
      '--color-fg-muted',
      '--color-line',
      '--color-primary',
      '--color-primary-hover',
      '--color-primary-fg',
      '--color-accent',
    ]) {
      expect(darkNames.has(name), name).toBe(true);
    }
  });
});
