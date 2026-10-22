import { readFileSync } from 'node:fs';

// package.json sits one level above both src/ and dist/, so the same lookup works in each.
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  version: string;
};

export const VERSION = manifest.version;
