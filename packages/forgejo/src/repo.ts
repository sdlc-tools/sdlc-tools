import { CliError, urlPath } from '@sdlc-tools/core';

export interface RepoRef {
  readonly owner: string;
  readonly name: string;
}

export function formatRepo(repo: RepoRef): string {
  return `${repo.owner}/${repo.name}`;
}

/** `/repos/<owner>/<name>`, each part percent-encoded as one path segment. */
export function repoPath(repo: RepoRef): string {
  return urlPath`/repos/${repo.owner}/${repo.name}`;
}

/** Parses `owner/name`; throws a usage error for anything else. */
export function parseRepoRef(value: string): RepoRef {
  const parts = value.trim().split('/');
  const [owner, name] = parts;
  if (
    parts.length !== 2 ||
    owner === undefined ||
    name === undefined ||
    !/^[\w.-]+$/.test(owner) ||
    !/^[\w.-]+$/.test(name) ||
    owner === '.' ||
    owner === '..' ||
    name === '.' ||
    name === '..'
  ) {
    throw new CliError('usage', `"${value}" is not a repository in the form owner/name.`, {
      code: 'invalid_repo',
      next: ['Write the repository as owner/name, for example "my-team/my-project".'],
    });
  }
  return { owner, name };
}

export interface RemoteLocation extends RepoRef {
  readonly hostname: string;
}

/**
 * Reads the host and `owner/name` out of a git remote URL: `https://host/owner/name.git`,
 * `ssh://git@host:2222/owner/name.git` and `git@host:owner/name.git`. Only the last two path
 * segments count, so a server hosted under a path prefix works.
 */
export function parseRemoteUrl(raw: string): RemoteLocation | undefined {
  const text = raw.trim();
  let hostname: string;
  let path: string;

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) {
    try {
      const url = new URL(text);
      hostname = url.hostname;
      path = url.pathname;
    } catch {
      return undefined;
    }
  } else {
    const scp = /^(?:[^@/\s]+@)?([^:/\s]+):(.+)$/.exec(text);
    if (scp?.[1] === undefined || scp[2] === undefined) return undefined;
    hostname = scp[1];
    path = scp[2];
  }

  const segments = path.split('/').filter((segment) => segment !== '');
  const last = segments.at(-1);
  const owner = segments.at(-2);
  if (hostname === '' || last === undefined || owner === undefined) return undefined;
  const name = last.replace(/\.git$/, '');
  if (name === '') return undefined;
  return { hostname: hostname.toLowerCase(), owner, name };
}
