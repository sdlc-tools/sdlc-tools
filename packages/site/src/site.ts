import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { en, ko } from './content.js';
import { tokensCss } from './design/tokens.js';
import { renderPage } from './page.js';

/** Stylesheets and static files sit next to `src/` and `dist/`, so both locate them alike. */
const PACKAGE_ROOT = new URL('../', import.meta.url);
/** The logos are the repository's own assets, shared with the READMEs. */
const ASSETS = new URL('../../assets/', PACKAGE_ROOT);
const LOGOS = ['logo.svg', 'logo-dark.svg'] as const;
const STYLE_FILES = ['base.css', 'components.css'] as const;

export async function stylesheet(): Promise<string> {
  const sheets = await Promise.all(
    STYLE_FILES.map((name) => readFile(new URL(`styles/${name}`, PACKAGE_ROOT), 'utf8')),
  );
  return [tokensCss(), ...sheets].join('\n');
}

/** Writes the whole site into `outDir`, replacing what was there. */
export async function buildSite(outDir: string): Promise<void> {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(join(outDir, 'ko'), { recursive: true });
  await Promise.all([
    ...LOGOS.map((name) => copyFile(new URL(name, ASSETS), join(outDir, name))),
    writeFile(join(outDir, 'styles.css'), await stylesheet()),
    writeFile(join(outDir, 'index.html'), renderPage(en, { root: '', switchHref: 'ko/' })),
    writeFile(join(outDir, 'ko', 'index.html'), renderPage(ko, { root: '../', switchHref: '../' })),
  ]);
}
