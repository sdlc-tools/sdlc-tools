import {
  CliError,
  normalizeServerUrl,
  resolveSettings,
  toolEnvVar,
  type ConfigEnvironment,
  type ServerUrl,
  type SettingSpecs,
} from '@sdlc-tools/core';
import type { Ports } from './ports.js';
import { formatRepo, parseRemoteUrl, parseRepoRef, type RepoRef } from './repo.js';

export const TOOL = 'forgejo';
export const LOGIN_COMMAND = 'sdlc-forgejo auth login';

const envVar = (name: string): string => toolEnvVar(TOOL, name);

function validatePort(value: string): string {
  const port = Number(value);
  if (!/^\d+$/.test(value) || port < 1 || port > 65_535) {
    throw new CliError('usage', `"${value}" is not a valid port number.`, {
      code: 'invalid_port',
      next: ['Use a number between 1 and 65535.'],
    });
  }
  return value;
}

/**
 * Every setting the tool reads, resolved flag, environment variable, project file, user file.
 * Settings that decide where credentials go (server, OAuth application, account) never come from
 * the project file: a repository you did not write must not choose them.
 */
export const settingCatalog = {
  host: {
    label: 'Forgejo server address',
    key: 'host',
    env: envVar('host'),
    flag: '--host',
    required: true,
    fromProjectFile: false,
    validate: (value: string) => normalizeServerUrl(value, 'Forgejo server address').baseUrl,
  },
  profile: {
    label: 'credential profile',
    key: 'profile',
    env: envVar('profile'),
    flag: '--profile',
    fromProjectFile: false,
  },
  clientId: {
    label: 'OAuth client id',
    key: 'clientId',
    env: envVar('client_id'),
    flag: '--client-id',
    fromProjectFile: false,
  },
  callbackPort: {
    label: 'sign-in callback port',
    key: 'callbackPort',
    env: envVar('callback_port'),
    flag: '--callback-port',
    fromProjectFile: false,
    validate: validatePort,
  },
  scopes: {
    label: 'OAuth scopes',
    key: 'scopes',
    env: envVar('scopes'),
    flag: '--scopes',
    fromProjectFile: false,
  },
  repo: {
    label: 'repository',
    key: 'repo',
    env: envVar('repo'),
    flag: '--repo',
    validate: (value: string) => formatRepo(parseRepoRef(value)),
  },
  base: {
    label: 'default base branch',
    key: 'base',
    env: envVar('base'),
    flag: '--base',
  },
  reviewers: {
    label: 'default reviewers',
    key: 'reviewers',
    env: envVar('reviewers'),
    flag: '--reviewer',
  },
  labels: {
    label: 'default labels',
    key: 'labels',
    env: envVar('labels'),
    flag: '--label',
  },
  prTitlePattern: {
    label: 'pull request title pattern',
    key: 'prTitlePattern',
    env: envVar('pr_title_pattern'),
  },
  prRequiredSections: {
    label: 'required description sections',
    key: 'prRequiredSections',
    env: envVar('pr_required_sections'),
  },
  // The merge policy has no flags: a policy the command line can switch off is not enforced.
  mergeRequiredStatuses: {
    label: 'required status contexts',
    key: 'mergeRequiredStatuses',
    env: envVar('merge_required_statuses'),
  },
  mergeRequiredApprovals: {
    label: 'required approvals',
    key: 'mergeRequiredApprovals',
    env: envVar('merge_required_approvals'),
  },
  mergeApprovers: {
    label: 'approvers',
    key: 'mergeApprovers',
    env: envVar('merge_approvers'),
  },
  mergeMethods: {
    label: 'allowed merge methods',
    key: 'mergeMethods',
    env: envVar('merge_methods'),
  },
} as const satisfies SettingSpecs;

/** The settings that make up the merge policy, in the order `buildMergePolicy` reads them. */
export const MERGE_POLICY_SETTINGS = [
  'mergeRequiredStatuses',
  'mergeRequiredApprovals',
  'mergeApprovers',
  'mergeMethods',
] as const satisfies readonly SettingName[];

export type SettingName = keyof typeof settingCatalog;

type Flags<K extends SettingName> = Readonly<Partial<Record<K, string | undefined>>>;

/** Resolves the named settings of the `forgejo` section; `flags` carries the values given on the command line. */
export function resolveToolSettings<const K extends SettingName>(
  runtime: ConfigEnvironment,
  names: readonly K[],
  flags: Flags<K>,
) {
  const specs = Object.fromEntries(names.map((name) => [name, settingCatalog[name]])) as Pick<
    typeof settingCatalog,
    K
  >;
  return resolveSettings(runtime, TOOL, specs, flags);
}

/**
 * The repository a command works on: the setting when there is one, otherwise the `origin` remote
 * of the checkout — but only when that remote lives on the configured server. A remote is as
 * repository-controlled as a project file, so it is never allowed to pick the server.
 */
export async function resolveRepo(
  runtime: Pick<ConfigEnvironment, 'cwd'>,
  ports: Ports,
  server: ServerUrl,
  configured: string | undefined,
): Promise<RepoRef> {
  if (configured !== undefined) return parseRepoRef(configured);

  const remote = await ports.git.remoteUrl(runtime.cwd, 'origin');
  const location = remote === undefined ? undefined : parseRemoteUrl(remote);
  const serverHost = new URL(server.baseUrl).hostname.toLowerCase();
  if (location?.hostname === serverHost) return location;

  const reason =
    location === undefined
      ? 'The current directory is not a checkout with an "origin" remote.'
      : `The "origin" remote points to ${location.hostname}, not to ${serverHost}.`;
  throw new CliError('config', 'Missing repository.', {
    code: 'missing_setting',
    causes: [reason],
    next: [
      'Pass --repo owner/name.',
      `Set the ${envVar('repo')} environment variable.`,
      'Add "repo" under "forgejo" in .sdlc-tools.json.',
      `Or run the command inside a checkout whose "origin" remote is on ${serverHost}.`,
    ],
  });
}
