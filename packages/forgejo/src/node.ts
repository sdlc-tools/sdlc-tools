import { readFile } from 'node:fs/promises';
import { createNodeGit } from './git.js';
import type { Ports } from './ports.js';

/** The real environment: `git` on the PATH and the file system. */
export function createNodePorts(): Ports {
  return {
    git: createNodeGit(),
    readTextFile: (path) => readFile(path, 'utf8'),
  };
}

/** The `version` field of this package's own `package.json`. */
export async function readPackageVersion(): Promise<string> {
  const manifest = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  ) as { version?: unknown };
  return typeof manifest.version === 'string' ? manifest.version : '0.0.0';
}
