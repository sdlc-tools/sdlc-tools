import { execFile } from 'node:child_process';
import { CliError } from '@sdlc-tools/core';
import type { Git } from './ports.js';

const GIT_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

interface GitFailure {
  readonly stderr: string;
  readonly missing: boolean;
}

function run(cwd: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      ['-C', cwd, ...args],
      { encoding: 'utf8', timeout: GIT_TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve(stdout);
          return;
        }
        const failure: GitFailure = {
          stderr: stderr.trim() === '' ? error.message : stderr.trim(),
          missing: (error as NodeJS.ErrnoException).code === 'ENOENT',
        };
        reject(Object.assign(new Error(failure.stderr), failure));
      },
    );
  });
}

async function query(cwd: string, args: readonly string[]): Promise<string | undefined> {
  try {
    return (await run(cwd, args)).trim();
  } catch {
    return undefined;
  }
}

async function mutate(cwd: string, args: readonly string[]): Promise<void> {
  try {
    await run(cwd, args);
  } catch (error) {
    const failure = error as Partial<GitFailure> & Error;
    throw new CliError('unexpected', `git ${args[0] ?? ''} failed: ${failure.message}`, {
      code: failure.missing === true ? 'git_missing' : 'git_failed',
      next:
        failure.missing === true
          ? ['Install git and make sure it is on the PATH.']
          : ['Fix the problem git reports, then run the command again.'],
      cause: error,
    });
  }
}

/** `git` on the PATH, run in the given directory. */
export function createNodeGit(): Git {
  return {
    remoteUrl: async (cwd, remote) => {
      const url = await query(cwd, ['remote', 'get-url', remote]);
      return url === '' ? undefined : url;
    },
    currentBranch: async (cwd) => {
      const branch = await query(cwd, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
      return branch === '' ? undefined : branch;
    },
    resolveRef: async (cwd, ref) => {
      const sha = await query(cwd, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
      return sha === '' ? undefined : sha;
    },
    uncommittedChanges: async (cwd) => {
      const status = await query(cwd, ['status', '--porcelain']);
      return status === undefined ? undefined : status.split('\n').filter((line) => line !== '');
    },
    fetchPrune: (cwd, remote) => mutate(cwd, ['fetch', '--prune', remote]),
    isAncestor: async (cwd, ancestor, descendant) => {
      try {
        await run(cwd, ['merge-base', '--is-ancestor', ancestor, descendant]);
        return true;
      } catch {
        return false;
      }
    },
    removeWorktree: (cwd, path) => mutate(cwd, ['worktree', 'remove', '--', path]),
    deleteBranch: (cwd, branch) => mutate(cwd, ['branch', '-D', '--', branch]),
  };
}
