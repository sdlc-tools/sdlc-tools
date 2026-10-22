import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createNodeGit } from './git.js';
import type { Ports } from './ports.js';

async function readStdin(): Promise<string> {
  let text = '';
  // File descriptor 0 is standard input; the empty path is ignored when a descriptor is given.
  for await (const chunk of createReadStream('', { fd: 0, encoding: 'utf8', autoClose: false })) {
    text += chunk as string;
  }
  return text;
}

/** The real environment: `git` on the PATH, standard input and the file system. */
export function createNodePorts(): Ports {
  return {
    git: createNodeGit(),
    readStdin,
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
