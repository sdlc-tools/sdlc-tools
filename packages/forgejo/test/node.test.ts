import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createNodePorts } from '../src/index.js';
import { readPackageVersion } from '../src/node.js';

describe('node ports', () => {
  it('reads the version from the package manifest', async () => {
    expect(await readPackageVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('reads a text file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sdlc-forgejo-ports-'));
    try {
      const file = join(dir, 'description.md');
      writeFileSync(file, 'héllo');
      expect(await createNodePorts().readTextFile(file)).toBe('héllo');
      await expect(createNodePorts().readTextFile(join(dir, 'missing.md'))).rejects.toThrow(
        'ENOENT',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
