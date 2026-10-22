// Publishes the packed tarballs in a directory under one dist-tag. A version the
// registry already has is skipped, so a run that failed halfway can be repeated.
// Authentication is whatever npm finds: trusted publishing (OIDC) on the release
// runner. With --dry-run it only lists what would be published.
//
// --snapshot-only limits the run to versions that `changeset version --snapshot
// <tag>` produced (`1.2.3-<tag>-<datetime>`). `pnpm -r pack` also packs the
// packages the snapshot did not bump; those keep their released version and are
// reported as unchanged, never published.
//
//   node scripts/publish-tarballs.mjs --tag beta [--snapshot-only] [--dry-run] <tarball-dir>
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    tag: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
    'snapshot-only': { type: 'boolean', default: false },
  },
});
const [dir] = positionals;
if (!values.tag || !dir || positionals.length !== 1) {
  console.error(
    'usage: publish-tarballs.mjs --tag <dist-tag> [--snapshot-only] [--dry-run] <tarball-dir>',
  );
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

// Only a registry "not found" means unpublished; any other failure (network,
// auth) must stop the run rather than be read as "publish it".
const isPublished = (spec) => {
  try {
    execFileSync('npm', ['view', spec, 'version'], { stdio: ['ignore', 'ignore', 'pipe'] });
    return true;
  } catch (error) {
    if (String(error.stderr).includes('E404')) return false;
    throw error;
  }
};

const snapshotPattern = new RegExp(`^\\d+\\.\\d+\\.\\d+-${values.tag}-\\d+$`);

for (const tarball of tarballs) {
  const { name, version } = manifestOf(tarball);
  const spec = `${name}@${version}`;
  if (values['snapshot-only'] && !snapshotPattern.test(version)) {
    console.log(`${spec} is unchanged; skipping`);
    continue;
  }
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
