// Gives every public workspace package a `-beta.0` prerelease of its current
// version, so the bootstrap publish leaves the stable version to the first
// release that goes through trusted publishing. Edits the checkout only; the
// publish workflow never commits it.
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const PRERELEASE = 'beta.0';
const root = new URL('../packages/', import.meta.url);

for (const entry of await readdir(root, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const file = join(root.pathname, entry.name, 'package.json');
  const manifest = JSON.parse(await readFile(file, 'utf8'));
  if (manifest.private) continue;
  if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) {
    throw new Error(
      `${manifest.name}@${manifest.version} is not a stable version to base a prerelease on`,
    );
  }
  manifest.version = `${manifest.version}-${PRERELEASE}`;
  await writeFile(file, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`${manifest.name}@${manifest.version}`);
}
