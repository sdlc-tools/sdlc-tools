import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildSite } from '../src/site.js';

let out: string;
beforeAll(async () => {
  out = await mkdtemp(join(tmpdir(), 'sdlc-site-'));
  await buildSite(out);
});
afterAll(async () => {
  await rm(out, { recursive: true, force: true });
});

const pages = [
  ['en', 'index.html'],
  ['ko', join('ko', 'index.html')],
] as const;

const read = (file: string): string => readFileSync(join(out, file), 'utf8');
const tags = (page: string): string[] =>
  [...page.matchAll(/<([a-z][a-z0-9]*)\b([^>]*)>/g)].map((m) => {
    const id = /\bid="([^"]+)"/.exec(m[2] ?? '')?.[1];
    return id ? `${m[1] ?? ''}#${id}` : (m[1] ?? '');
  });
const attrs = (page: string, name: string): string[] =>
  [...page.matchAll(new RegExp(`\\s${name}="([^"]*)"`, 'g'))].map((m) => m[1] ?? '');

describe('both languages', () => {
  it('render the same structure: tags, sections and ids in the same order', () => {
    expect(tags(read(pages[1][1]))).toEqual(tags(read(pages[0][1])));
  });

  it('declare their own language and link to each other', () => {
    const [en, ko] = [read(pages[0][1]), read(pages[1][1])];
    expect(en).toContain('<html lang="en">');
    expect(ko).toContain('<html lang="ko">');
    expect(en).toMatch(/<a\s[^>]*href="ko\/"[^>]*hreflang="ko"/);
    expect(ko).toMatch(/<a\s[^>]*href="\.\.\/"[^>]*hreflang="en"/);
  });
});

describe.each(pages)('%s page', (_lang, file) => {
  const page = () => read(file);

  it('has one h1, the landmarks and distinct navigation names', () => {
    expect(page().match(/<h1\b/g)).toHaveLength(1);
    for (const landmark of ['header', 'main', 'footer']) {
      expect(page().match(new RegExp(`<${landmark}\\b`, 'g'))).toHaveLength(1);
    }
    const names = [...page().matchAll(/<nav\b[^>]*aria-label="([^"]+)"/g)].map((m) => m[1]);
    expect(names).toHaveLength(2);
    expect(new Set(names).size).toBe(2);
  });

  it('has unique ids and every in-page link has a target', () => {
    const ids = attrs(page(), 'id');
    expect(new Set(ids).size).toBe(ids.length);
    const anchors = attrs(page(), 'href').filter((href) => href.startsWith('#'));
    expect(anchors.length).toBeGreaterThan(0);
    for (const anchor of anchors) expect(ids).toContain(anchor.slice(1));
  });

  it('resolves every local file reference', () => {
    const refs = [
      ...attrs(page(), 'href'),
      ...attrs(page(), 'src'),
      ...attrs(page(), 'srcset'),
    ].filter((ref) => !/^(?:https?:|#)/.test(ref));
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      const target = resolve(out, dirname(file), ref);
      const found = ref.endsWith('/') ? join(target, 'index.html') : target;
      expect(existsSync(found), `${ref} -> ${found}`).toBe(true);
    }
  });

  it('runs no script and loads nothing remote', () => {
    expect(page()).not.toMatch(/<script\b/i);
    expect(page()).not.toMatch(/\son[a-z]+=/i);
    const loaded = [...attrs(page(), 'src'), ...attrs(page(), 'srcset')];
    const sheets = [...page().matchAll(/<link\b[^>]*rel="stylesheet"[^>]*>/g)].flatMap((m) =>
      attrs(m[0], 'href'),
    );
    for (const ref of [...loaded, ...sheets]) expect(ref).not.toMatch(/^(?:https?:)?\/\//);
  });

  it('gives every link a name, every image a text alternative and every scroller a tab stop', () => {
    for (const [, inner] of page().matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/g)) {
      expect((inner ?? '').replace(/<[^>]+>/g, '').trim()).not.toBe('');
    }
    for (const [tag] of page().matchAll(/<img\b[^>]*>/g)) expect(tag).toContain('alt=');
    for (const [tag] of page().matchAll(/<pre\b[^>]*>/g)) expect(tag).toContain('tabindex="0"');
  });

  it('keeps each terminal line on its own line', () => {
    for (const [, body] of page().matchAll(/<pre\b[^>]*><code>([\s\S]*?)<\/code><\/pre>/g)) {
      const text = (body ?? '').replace(/<[^>]+>/g, '');
      expect(text.split('\n').filter((entry) => entry.length > 0).length).toBeGreaterThan(0);
      expect(text).not.toMatch(/\S \$ /);
    }
  });

  it('sets the viewport without blocking zoom', () => {
    const viewport = /<meta name="viewport" content="([^"]+)"/.exec(page())?.[1] ?? '';
    expect(viewport).toBe('width=device-width, initial-scale=1');
  });
});

describe('stylesheet', () => {
  it('ships both themes and loads nothing remote', () => {
    const css = read('styles.css');
    expect(css).toContain('@media (prefers-color-scheme: dark)');
    expect(css).not.toMatch(/@import|url\(/);
  });
});
