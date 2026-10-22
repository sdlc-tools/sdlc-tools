import { CliError, type CommandContext, type OptionMap } from '@sdlc-tools/core';
import type { Ports } from '../ports.js';
import { openSession, targetFor, type ConnectionSettings, type Session } from '../session.js';
import { resolveRepo } from '../settings.js';
import type { RepoRef } from '../repo.js';

export const serverOptions = {
  host: {
    type: 'string',
    valueName: 'url',
    description: 'Forgejo server address (SDLC_FORGEJO_HOST, or "host" in the configuration)',
  },
  profile: {
    type: 'string',
    valueName: 'name',
    description: 'Credential profile, to keep several accounts on one server apart',
  },
} as const satisfies OptionMap;

export const repoOptions = {
  ...serverOptions,
  repo: {
    type: 'string',
    valueName: 'owner/name',
    description:
      'Repository (SDLC_FORGEJO_REPO, "repo" in the configuration, or the origin remote)',
  },
} as const satisfies OptionMap;

export interface RepoSettings extends ConnectionSettings {
  readonly repo: string | undefined;
}

export interface RepoSession extends Session {
  readonly repo: RepoRef;
}

/**
 * Resolves the repository and the credentials. Everything here is local: a missing repository or
 * a missing sign-in fails before the first request.
 */
export async function openRepoSession(
  context: CommandContext,
  ports: Ports,
  settings: RepoSettings,
): Promise<RepoSession> {
  const { server } = targetFor(settings);
  const repo = await resolveRepo(context, ports, server, settings.repo);
  const session = await openSession(context, settings);
  return { ...session, repo };
}

/** A pull request number as typed: `12` or `#12`. */
export function parsePullNumber(value: string): number {
  const match = /^#?([1-9]\d*)$/.exec(value.trim());
  if (match?.[1] === undefined) {
    throw new CliError('usage', `"${value}" is not a pull request number.`, {
      code: 'invalid_pull_number',
      next: ['Give the number shown by `sdlc-forgejo pr list`, for example 12.'],
    });
  }
  return Number(match[1]);
}

export function assertBranchName(name: string, label: string): string {
  const branch = name.trim();
  if (branch === '' || branch.startsWith('-') || /[\s~^:?*[\\]/.test(branch)) {
    throw new CliError('usage', `"${name}" is not a valid ${label} name.`, {
      code: 'invalid_branch',
      next: ['Give the branch name as it appears in `git branch`.'],
    });
  }
  return branch;
}
