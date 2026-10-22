import { defineCommand, defineGroup } from '@sdlc-tools/core';
import type { Ports } from '../ports.js';
import { blockedError } from '../rules.js';
import { formatRepo } from '../repo.js';
import { resolveToolSettings } from '../settings.js';
import { assertBranchName, openRepoSession, repoOptions } from './shared.js';

const REMOTE = 'origin';

export function branchGroup(ports: Ports) {
  const cleanup = defineCommand({
    name: 'cleanup',
    summary: 'Delete a merged branch locally and on the server',
    description: [
      'Deletes the local branch, the server branch and, with --worktree, a linked worktree, but only after',
      `git proves that the branch is contained in ${REMOTE}/<base>. The default branch and branches the server`,
      'protects are refused. A worktree with uncommitted changes is never removed.',
    ].join(' '),
    positionals: [{ name: 'branch', description: 'Branch to delete', required: true }],
    options: {
      ...repoOptions,
      base: {
        type: 'string',
        valueName: 'branch',
        description: 'Branch it was merged into (default: the repository default branch)',
      },
      worktree: {
        type: 'string',
        valueName: 'path',
        description: 'Linked worktree to remove first',
      },
    },
    async run({ options, args }, context) {
      const branch = assertBranchName(args.branch, 'branch');
      const { values } = await resolveToolSettings(
        context,
        ['host', 'profile', 'clientId', 'repo', 'base'],
        { host: options.host, profile: options.profile, repo: options.repo, base: options.base },
      );
      const { api, repo } = await openRepoSession(context, ports, values);
      const cwd = context.cwd;

      const repository = await api.getRepository(repo);
      const base =
        values.base === undefined
          ? repository.defaultBranch
          : assertBranchName(values.base, 'base');
      const remoteBranch = await api.getBranch(repo, branch);

      const violations: string[] = [];
      if (branch === repository.defaultBranch || branch === base) {
        const role = branch === repository.defaultBranch ? 'default' : 'base';
        violations.push(`"${branch}" is the ${role} branch and is never deleted.`);
      }
      if (remoteBranch?.protected === true) {
        violations.push(`The server protects "${branch}".`);
      }
      if ((await ports.git.currentBranch(cwd)) === branch) {
        violations.push(`"${branch}" is checked out here; switch to another branch first.`);
      }
      if (violations.length === 0) await ports.git.fetchPrune(cwd, REMOTE);

      const baseRef = `refs/remotes/${REMOTE}/${base}`;
      const localRef = `refs/heads/${branch}`;
      const trackingRef = `refs/remotes/${REMOTE}/${branch}`;
      const localSha =
        violations.length === 0 ? await ports.git.resolveRef(cwd, localRef) : undefined;
      if (violations.length === 0) {
        if ((await ports.git.resolveRef(cwd, baseRef)) === undefined) {
          violations.push(
            `${REMOTE}/${base} does not exist, so nothing can be proven merged into it.`,
          );
        }
        if (localSha !== undefined && !(await ports.git.isAncestor(cwd, localRef, baseRef))) {
          violations.push(`The local branch "${branch}" is not contained in ${REMOTE}/${base}.`);
        }
        if (remoteBranch !== undefined) {
          if ((await ports.git.resolveRef(cwd, trackingRef)) === undefined) {
            violations.push(
              `The server has "${branch}", but ${REMOTE}/${branch} was not fetched, so it cannot be checked.`,
            );
          } else if (!(await ports.git.isAncestor(cwd, trackingRef, baseRef))) {
            violations.push(`${REMOTE}/${branch} is not contained in ${REMOTE}/${base}.`);
          }
        }
      }
      if (violations.length > 0) {
        throw blockedError(
          'cleanup_blocked',
          `"${branch}" was not deleted.`,
          { violations, warnings: [] },
          [
            'Nothing was removed. Merge the branch first, or pass --base with the branch it was merged into.',
          ],
        );
      }

      const removed: string[] = [];
      if (options.worktree !== undefined) {
        await ports.git.removeWorktree(cwd, options.worktree);
        removed.push(`worktree ${options.worktree}`);
      }
      if (localSha !== undefined) {
        await ports.git.deleteBranch(cwd, branch);
        removed.push(`local branch ${branch}`);
      }
      if (remoteBranch !== undefined) {
        await api.deleteBranch(repo, branch);
        removed.push(`server branch ${branch}`);
      }
      return {
        data: { repo: formatRepo(repo), branch, base, removed },
        text:
          removed.length === 0
            ? `Nothing to clean up for ${branch}.`
            : `Removed ${removed.join(', ')}.`,
      };
    },
  });

  return defineGroup({
    name: 'branch',
    summary: 'Clean up branches',
    commands: [cleanup],
  });
}
