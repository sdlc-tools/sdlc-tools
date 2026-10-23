import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  colorRoles,
  contrastRequirements,
  dark,
  decorativeRoles,
  light,
  primitives,
  tokensCss,
  type Theme,
} from '../src/design/tokens.js';
import { contrast } from './contrast.js';

const hex = (theme: Theme, role: keyof Theme): string => primitives[theme[role]];

describe.each([
  ['light', light],
  ['dark', dark],
] as const)('%s theme contrast (WCAG 2.2 AA)', (_name, theme) => {
  it.each(contrastRequirements)('%s on %s is at least %s:1', (foreground, background, minimum) => {
    expect(contrast(hex(theme, foreground), hex(theme, background))).toBeGreaterThanOrEqual(
      minimum,
    );
  });
});

describe('token coverage', () => {
  it('requires a contrast check for every color role that is not decorative', () => {
    const covered = new Set(
      contrastRequirements.flat().filter((entry) => typeof entry === 'string'),
    );
    const missing = colorRoles.filter(
      (role) => !covered.has(role) && !decorativeRoles.includes(role),
    );
    expect(missing).toEqual([]);
  });

  it('maps every role in both themes', () => {
    expect(Object.keys(light).sort()).toEqual([...colorRoles].sort());
    expect(Object.keys(dark).sort()).toEqual([...colorRoles].sort());
  });

  it('swaps only semantic values between the themes', () => {
    const css = tokensCss();
    const darkBlock = css.slice(css.indexOf('@media (prefers-color-scheme: dark)'));
    expect(darkBlock).not.toMatch(/--prim-[\w-]+:/);
    expect(darkBlock).toContain('--color-bg: var(--prim-slate-900)');
    expect(css).toContain('--color-bg: var(--prim-white)');
  });
});

describe('component stylesheets', () => {
  const sheets = ['base.css', 'components.css'].map(
    (name) => [name, readFileSync(new URL(`../styles/${name}`, import.meta.url), 'utf8')] as const,
  );
  const defined = new Set([...tokensCss().matchAll(/^\s*--([\w-]+):/gm)].map((m) => m[1]));

  it.each(sheets)('%s names no primitive token and no literal color', (_name, css) => {
    expect(css).not.toMatch(/--prim-/);
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(css).not.toMatch(/\b(?:rgb|rgba|hsl|hsla|oklch|oklab|lab|lch)\(/i);
  });

  it.each(sheets)('%s only references tokens that exist', (_name, css) => {
    const used = [...css.matchAll(/var\(--([\w-]+)/g)].map((m) => m[1]);
    expect(used.filter((name) => !defined.has(name ?? ''))).toEqual([]);
  });

  it.each(sheets)('%s does not load anything from the network', (_name, css) => {
    expect(css).not.toMatch(/@import|url\(/);
  });
});
