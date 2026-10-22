// Publishes the packed tarballs in a directory under one dist-tag. A version the
// registry already has is skipped, so a run that failed halfway can be repeated.
// Authentication is whatever npm finds: trusted publishing (OIDC) on the release
// runner. With --dry-run it only lists what would be published.
//
//   node scripts/publish-tarballs.mjs --tag beta [--dry-run] <tarball-dir>
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    tag: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
  },
});
const [dir] = positionals;
if (!values.tag || !dir || positionals.length !== 1) {
  console.error('usage: publish-tarballs.mjs --tag <dist-tag> [--dry-run] <tarball-dir>');
  process.exit(2);
}

const tarballs = readdirSync(dir)
  .filter((file) => file.endsWith('.tgz'))
  .sort()
  .map((file) => resolve(join(dir, file)));
if (tarballs.length === 0) {
  console.error(`no tarballs in ${dir}`);
  process.exit(1);
}

const manifestOf = (tarball) =>
  JSON.parse(execFileSync('tar', ['-xOf', tarball, 'package/package.json'], { encoding: 'utf8' }));

const isPublished = (spec) => {
  try {
    execFileSync('npm', ['view', spec, 'version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

for (const tarball of tarballs) {
  const { name, version } = manifestOf(tarball);
  const spec = `${name}@${version}`;
  if (values['dry-run']) {
    console.log(`would publish ${spec} with dist-tag ${values.tag}`);
    continue;
  }
  if (isPublished(spec)) {
    console.log(`${spec} is already published; skipping`);
    continue;
  }
  execFileSync(
    'npm',
    ['publish', tarball, '--tag', values.tag, '--access', 'public', '--provenance'],
    { stdio: 'inherit' },
  );
}
