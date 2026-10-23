import {
  CliError,
  HttpClient,
  OAuthSession,
  basicAuth,
  loadConfigFiles,
  normalizeServerUrl,
  resolveCredential,
  resolveSettings,
  toolEnvVar,
  validatePort,
  type AuthProvider,
  type CommandContext,
  type CredentialTarget,
  type OAuthCredential,
  type OptionMap,
  type ResolvedCredential,
  type ServerUrl,
} from '@sdlc-tools/core';
import { JiraClient } from './client.js';
import { OAUTH_LOGIN_COMMAND, atlassianClient, gatewayBaseUrl, loadOAuthApp } from './oauth.js';

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
  readonly kind: 'token' | 'oauth';
  /** The e-mail address stored with an API token; an OAuth sign-in has none. */
  readonly email: string | undefined;
  readonly source: 'env' | 'keychain';
  /** Present for an OAuth sign-in; its credential holds the tokens as renewed by the requests made so far. */
  readonly session: OAuthSession | undefined;
}

export const credentialTarget = (target: SiteTarget): CredentialTarget => ({
  tool: TOOL,
  origin: target.site.origin,
  profile: target.profile,
});

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

export interface OAuthSettings {
  readonly clientId: string;
  readonly callbackPort: number;
}

/**
 * The OAuth app's client id and the fixed callback port. Atlassian only redirects to the exact
 * callback URL registered on the app, so both are required. Neither may come from a repository
 * file: they decide which app receives the sign-in.
 */
export async function resolveOAuthSettings(
  context: CommandContext,
  flags: { readonly clientId: string | undefined; readonly callbackPort: string | undefined },
): Promise<OAuthSettings> {
  const { values } = await resolveSettings(
    context,
    TOOL,
    {
      clientId: {
        label: 'OAuth client id',
        key: 'clientId',
        env: toolEnvVar(TOOL, 'client_id'),
        flag: '--client-id',
        required: true,
        fromProjectFile: false,
      },
      callbackPort: {
        label: 'sign-in callback port',
        key: 'callbackPort',
        env: toolEnvVar(TOOL, 'callback_port'),
        flag: '--callback-port',
        required: true,
        fromProjectFile: false,
        validate: validatePort,
      },
    },
    flags,
  );
  return { clientId: values.clientId, callbackPort: Number(values.callbackPort) };
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

/** `server` names the site in error messages when `baseUrl` is not the site itself, as with the OAuth gateway. */
export function createHttp(
  context: CommandContext,
  baseUrl: string,
  authorization: AuthProvider,
  reauth: readonly string[],
  server?: string,
): HttpClient {
  return new HttpClient({
    baseUrl,
    fetch: context.fetch,
    signal: context.signal,
    auth: authorization,
    userAgent: 'sdlc-jira',
    context: { reauth, ...(server === undefined ? {} : { server }) },
  });
}

const REAUTH = [
  `Check that the API token has not expired or been revoked, and that ${EMAIL_ENV} (or the stored e-mail) is the account that owns it.`,
  `Sign in again with \`${LOGIN_COMMAND}\`, or set ${TOKEN_ENV}.`,
];

export const OAUTH_REAUTH = [
  `Sign in again with \`${OAUTH_LOGIN_COMMAND}\`.`,
  'If it keeps failing, check that the OAuth app still has the Jira scopes and that your access to the app was not revoked.',
];

/** The credential to use. With none, the way to sign in with OAuth is named next to the API token ones. */
async function findCredential(
  context: CommandContext,
  target: SiteTarget,
): Promise<ResolvedCredential> {
  try {
    return await resolveCredential(context, {
      ...credentialTarget(target),
      tokenEnv: TOKEN_ENV,
      usernameEnv: EMAIL_ENV,
      loginCommand: LOGIN_COMMAND,
    });
  } catch (error) {
    if (error instanceof CliError && error.code === 'no_credentials') {
      throw error.with({
        next: [...error.next, `Or sign in with OAuth using \`${OAUTH_LOGIN_COMMAND}\`.`],
      });
    }
    throw error;
  }
}

/** A client over the Atlassian API gateway, authenticated by the stored OAuth sign-in and renewing it as needed. */
async function connectWithOAuth(
  context: CommandContext,
  target: SiteTarget,
  credential: OAuthCredential,
): Promise<Connection> {
  const owner = credentialTarget(target);
  const app = await loadOAuthApp(context, owner);
  if (app === undefined) {
    throw new CliError('auth', 'The stored OAuth sign-in is incomplete.', {
      code: 'oauth_app_missing',
      causes: ['The client secret or the site it belongs to is missing from the keychain.'],
      next: [`Sign in again with \`${OAUTH_LOGIN_COMMAND}\`.`],
    });
  }
  const session = new OAuthSession({
    runtime: context,
    target: owner,
    client: atlassianClient(app),
    credential,
    loginCommand: OAUTH_LOGIN_COMMAND,
  });
  const http = createHttp(
    context,
    gatewayBaseUrl(app.cloudId),
    session,
    OAUTH_REAUTH,
    target.site.host,
  );
  return {
    ...target,
    client: new JiraClient(http, target.site.baseUrl),
    kind: 'oauth',
    email: undefined,
    source: 'keychain',
    session,
  };
}

/** Settings, then credentials, then a client; every failure happens before a request is sent. */
export async function connect(
  context: CommandContext,
  flags: ConnectionFlags,
): Promise<Connection> {
  const target = await resolveSite(context, flags);
  const resolved = await findCredential(context, target);
  if (resolved.credential.kind === 'oauth') {
    return connectWithOAuth(context, target, resolved.credential);
  }

  const { credential, source } = resolved;
  if (credential.username === undefined) {
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
    kind: 'token',
    email: credential.username,
    source,
    session: undefined,
  };
}

export const FIELD_TYPES = ['string', 'number', 'date', 'datetime', 'richtext', 'list'] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export interface FieldAlias {
  readonly alias: string;
  readonly id: string;
  /** Present when the configuration declares the value type, which lets the value be built without asking the site. */
  readonly type: FieldType | undefined;
}

/** Workflow settings of `jira` in the configuration files. */
export interface JiraConfig {
  readonly fields: ReadonlyMap<string, FieldAlias>;
  /** Status names in the order an issue moves through them. */
  readonly workflow: readonly string[];
}

function invalid(file: string, key: string, expected: string, next?: readonly string[]): CliError {
  return new CliError('config', `"${TOOL}.${key}" in ${file} must be ${expected}.`, {
    code: 'config_invalid_value',
    ...(next === undefined ? {} : { next }),
  });
}

function parseAlias(alias: string, raw: unknown, file: string): FieldAlias {
  const key = `fields.${alias}`;
  if (typeof raw === 'string' && raw !== '') return { alias, id: raw, type: undefined };
  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
    const { id, type } = raw as Record<string, unknown>;
    if (typeof id !== 'string' || id === '') throw invalid(file, `${key}.id`, 'a field id string');
    if (type !== undefined && !FIELD_TYPES.some((known) => known === type)) {
      throw invalid(file, `${key}.type`, `one of ${FIELD_TYPES.join(', ')}`);
    }
    return { alias, id, type: type as FieldType | undefined };
  }
  throw invalid(file, key, 'a field id string or an object with "id" and optional "type"', [
    'Put the field id in quotes.',
  ]);
}

function parseWorkflow(raw: unknown, file: string): string[] {
  if (
    !Array.isArray(raw) ||
    raw.length < 2 ||
    raw.some((name) => typeof name !== 'string' || name.trim() === '')
  ) {
    throw invalid(file, 'workflow', 'a list of at least two status names');
  }
  const names = (raw as string[]).map((name) => name.trim());
  if (new Set(names.map((name) => name.toLowerCase())).size !== names.length) {
    throw invalid(file, 'workflow', 'a list without repeated status names');
  }
  return names;
}

/** `jira.fields` and `jira.workflow` from the configuration files; the project file wins over the user file. */
export async function loadJiraConfig(context: CommandContext): Promise<JiraConfig> {
  const files = await loadConfigFiles(context);
  const fields = new Map<string, FieldAlias>();
  let workflow: readonly string[] = [];
  for (const file of [files.user, files.project]) {
    const section = file?.data[TOOL];
    if (typeof section !== 'object' || section === null) continue;
    const path = file?.path ?? 'the configuration';
    const { fields: rawFields, workflow: rawWorkflow } = section as Record<string, unknown>;
    if (rawFields !== undefined) {
      if (typeof rawFields !== 'object' || rawFields === null || Array.isArray(rawFields)) {
        throw invalid(path, 'fields', 'an object of alias to field id');
      }
      for (const [alias, raw] of Object.entries(rawFields)) {
        fields.set(alias.toLowerCase(), parseAlias(alias, raw, path));
      }
    }
    if (rawWorkflow !== undefined) workflow = parseWorkflow(rawWorkflow, path);
  }
  return { fields, workflow };
}
