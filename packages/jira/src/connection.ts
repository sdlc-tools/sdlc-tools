import {
  CliError,
  HttpClient,
  basicAuth,
  loadConfigFiles,
  normalizeServerUrl,
  resolveCredential,
  resolveSettings,
  type AuthProvider,
  type CommandContext,
  type OptionMap,
  type ServerUrl,
} from '@sdlc-tools/core';
import { JiraClient } from './client.js';

export const TOOL = 'jira';
export const TOKEN_ENV = 'SDLC_JIRA_TOKEN';
export const EMAIL_ENV = 'SDLC_JIRA_EMAIL';
export const LOGIN_COMMAND = 'sdlc-jira auth login --email <email>';

/** Options every command that talks to Jira declares. */
export const connectionOptions = {
  site: {
    type: 'string',
    valueName: 'url',
    description: 'Jira Cloud site address (or SDLC_JIRA_SITE)',
  },
  profile: {
    type: 'string',
    valueName: 'name',
    description: 'Credential profile, for more than one account on a site (or SDLC_JIRA_PROFILE)',
  },
} as const satisfies OptionMap;

export interface ConnectionFlags {
  readonly site: string | undefined;
  readonly profile: string | undefined;
}

export interface SiteTarget {
  readonly site: ServerUrl;
  readonly profile: string | undefined;
}

export interface Connection extends SiteTarget {
  readonly client: JiraClient;
  readonly email: string;
  readonly source: 'env' | 'keychain';
}

/** The site address decides where credentials are sent, so only the flag, the environment and the user file may set it. */
export async function resolveSite(
  context: CommandContext,
  flags: ConnectionFlags,
): Promise<SiteTarget> {
  const { values } = await resolveSettings(
    context,
    TOOL,
    {
      site: {
        label: 'Jira site address',
        key: 'site',
        env: 'SDLC_JIRA_SITE',
        flag: '--site',
        required: true,
        fromProjectFile: false,
        validate: (value) => normalizeServerUrl(value, 'Jira site address').baseUrl,
      },
      profile: {
        label: 'credential profile',
        key: 'profile',
        env: 'SDLC_JIRA_PROFILE',
        flag: '--profile',
        fromProjectFile: false,
      },
    },
    { site: flags.site, profile: flags.profile },
  );
  return { site: normalizeServerUrl(values.site, 'Jira site address'), profile: values.profile };
}

const PROJECT_KEY = /^[A-Za-z][A-Za-z0-9_]*$/;

/** The default project key: flag, environment, then the project or user configuration file. */
export async function resolveProject(
  context: CommandContext,
  flag: string | undefined,
  required: true,
): Promise<string>;
export async function resolveProject(
  context: CommandContext,
  flag: string | undefined,
  required: boolean,
): Promise<string | undefined>;
export async function resolveProject(
  context: CommandContext,
  flag: string | undefined,
  required: boolean,
): Promise<string | undefined> {
  const { values } = await resolveSettings(
    context,
    TOOL,
    {
      project: {
        label: 'Jira project key',
        key: 'project',
        env: 'SDLC_JIRA_PROJECT',
        flag: '--project',
        required,
        validate: (value) => {
          if (!PROJECT_KEY.test(value)) {
            throw new CliError('usage', `"${value}" is not a valid Jira project key.`, {
              code: 'invalid_project_key',
              next: [
                'Use the short key shown before the dash in issue keys, such as the "ABC" in ABC-12.',
              ],
            });
          }
          return value;
        },
      },
    },
    { project: flag },
  );
  return values.project;
}

export function createHttp(
  context: CommandContext,
  baseUrl: string,
  authorization: AuthProvider,
  reauth: readonly string[],
): HttpClient {
  return new HttpClient({
    baseUrl,
    fetch: context.fetch,
    signal: context.signal,
    auth: authorization,
    userAgent: 'sdlc-jira',
    context: { reauth },
  });
}

const REAUTH = [
  `Check that the API token has not expired or been revoked, and that ${EMAIL_ENV} (or the stored e-mail) is the account that owns it.`,
  `Sign in again with \`${LOGIN_COMMAND}\` after setting ${TOKEN_ENV}.`,
];

/** Settings, then credentials, then a client; every failure happens before a request is sent. */
export async function connect(
  context: CommandContext,
  flags: ConnectionFlags,
): Promise<Connection> {
  const target = await resolveSite(context, flags);
  const { credential, source } = await resolveCredential(context, {
    tool: TOOL,
    origin: target.site.origin,
    profile: target.profile,
    tokenEnv: TOKEN_ENV,
    usernameEnv: EMAIL_ENV,
    loginCommand: LOGIN_COMMAND,
  });

  if (credential.kind !== 'token' || credential.username === undefined) {
    throw new CliError('auth', 'Jira needs an e-mail address together with the API token.', {
      code: 'missing_email',
      next: [`Set ${EMAIL_ENV} next to ${TOKEN_ENV}.`, `Or store both with \`${LOGIN_COMMAND}\`.`],
    });
  }

  const http = createHttp(
    context,
    target.site.baseUrl,
    basicAuth(credential.username, credential.token),
    REAUTH,
  );
  return {
    ...target,
    client: new JiraClient(http, target.site.baseUrl),
    email: credential.username,
    source,
  };
}

/** Field-id aliases from `jira.fields` in the configuration files; the project file wins over the user file. */
export async function loadFieldAliases(
  context: CommandContext,
): Promise<ReadonlyMap<string, string>> {
  const files = await loadConfigFiles(context);
  const aliases = new Map<string, string>();
  for (const file of [files.user, files.project]) {
    const section = file?.data[TOOL];
    const fields =
      typeof section === 'object' && section !== null
        ? (section as Record<string, unknown>).fields
        : undefined;
    if (fields === undefined) continue;
    if (typeof fields !== 'object' || fields === null || Array.isArray(fields)) {
      throw new CliError(
        'config',
        `"${TOOL}.fields" in ${file?.path ?? 'the configuration'} must be an object of alias to field id.`,
        {
          code: 'config_invalid_value',
        },
      );
    }
    for (const [alias, id] of Object.entries(fields)) {
      if (typeof id !== 'string' || id === '') {
        throw new CliError(
          'config',
          `"${TOOL}.fields.${alias}" in ${file?.path ?? 'the configuration'} must be a field id string.`,
          {
            code: 'config_invalid_value',
            next: ['Put the field id in quotes.'],
          },
        );
      }
      aliases.set(alias.toLowerCase(), id);
    }
  }
  return aliases;
}
