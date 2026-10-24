import {
  CliError,
  HttpClient,
  bearerAuth,
  credentialAccount,
  urlPath,
  type CommandContext,
  type CredentialTarget,
  type OAuthClient,
  type ServerUrl,
} from '@sdlc-tools/core';

/** OAuth 2.0 (3LO) against Atlassian Cloud: https://developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps/ */
const AUTHORIZATION_ENDPOINT = 'https://auth.atlassian.com/authorize';
const TOKEN_ENDPOINT = 'https://auth.atlassian.com/oauth/token';
const API_GATEWAY = 'https://api.atlassian.com';

export const OAUTH_LOGIN_COMMAND = 'sdlc-jira auth login --oauth';
export const OAUTH_SCOPES = [
  'read:jira-work',
  'write:jira-work',
  'read:jira-user',
  'offline_access',
] as const;

/** Both go in the authorization request; Atlassian requires them. */
export const OAUTH_AUTHORIZATION_PARAMETERS = {
  audience: 'api.atlassian.com',
  prompt: 'consent',
} as const;

/** The loopback callback path the app has to list, exactly, as its callback URL. */
export const CALLBACK_PATH = '/callback';

export const callbackUrl = (port: number): string => `http://127.0.0.1:${port}${CALLBACK_PATH}`;

/**
 * The OAuth app behind a stored sign-in, kept in the keychain next to the
 * tokens: the client secret is needed on every renewal, and the cloud id says
 * where the API gateway serves this site. The client id and the callback port
 * let a later sign-in run without being told the app again; a record written
 * before the port was kept has none. Nothing here comes from a file.
 */
export interface OAuthApp {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly cloudId: string;
  readonly callbackPort: number | undefined;
}

const APP_TOOL = 'jira-oauth';
const APP_FORMAT_VERSION = 1;

const appAccount = (target: CredentialTarget): CredentialTarget => ({ ...target, tool: APP_TOOL });

function parseApp(text: string): OAuthApp | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof raw !== 'object' || raw === null) return undefined;
  const { v, clientId, clientSecret, cloudId, callbackPort } = raw as Record<string, unknown>;
  if (
    v !== APP_FORMAT_VERSION ||
    typeof clientId !== 'string' ||
    typeof clientSecret !== 'string' ||
    typeof cloudId !== 'string' ||
    clientId === '' ||
    clientSecret === '' ||
    cloudId === ''
  ) {
    return undefined;
  }
  const port =
    typeof callbackPort === 'number' &&
    Number.isInteger(callbackPort) &&
    callbackPort >= 1 &&
    callbackPort <= 65535
      ? callbackPort
      : undefined;
  return { clientId, clientSecret, cloudId, callbackPort: port };
}

export async function saveOAuthApp(
  context: Pick<CommandContext, 'store'>,
  target: CredentialTarget,
  app: OAuthApp,
): Promise<void> {
  await context.store.set(
    credentialAccount(appAccount(target)),
    JSON.stringify({ v: APP_FORMAT_VERSION, ...app }),
  );
}

/** The stored app, or `undefined` when there is none or it cannot be read. */
export async function loadOAuthApp(
  context: Pick<CommandContext, 'store'>,
  target: CredentialTarget,
): Promise<OAuthApp | undefined> {
  const stored = await context.store.get(credentialAccount(appAccount(target)));
  return stored === null ? undefined : parseApp(stored);
}

/** Removes the client secret and cloud id; resolves `false` when there were none. */
export function deleteOAuthApp(
  context: Pick<CommandContext, 'store'>,
  target: CredentialTarget,
): Promise<boolean> {
  return context.store.delete(credentialAccount(appAccount(target)));
}

/** The OAuth client for the app. Atlassian takes JSON token requests and documents no PKCE. */
export function atlassianClient(
  app: Pick<OAuthApp, 'clientId' | 'clientSecret'>,
): OAuthClient & { readonly authorizationEndpoint: string } {
  return {
    clientId: app.clientId,
    clientSecret: app.clientSecret,
    authorizationEndpoint: AUTHORIZATION_ENDPOINT,
    tokenEndpoint: TOKEN_ENDPOINT,
    tokenRequestFormat: 'json',
  };
}

/** Where Jira REST calls for a site go once signed in with OAuth. */
export function gatewayBaseUrl(cloudId: string): string {
  return `${API_GATEWAY}${urlPath`/ex/jira/${cloudId}`}`;
}

interface AccessibleResource {
  readonly id: string;
  readonly url: string;
}

function isResource(value: unknown): value is AccessibleResource {
  if (typeof value !== 'object' || value === null) return false;
  const { id, url } = value as Record<string, unknown>;
  return typeof id === 'string' && id !== '' && typeof url === 'string';
}

function originOf(address: string): string | undefined {
  try {
    return new URL(address).origin;
  } catch {
    return undefined;
  }
}

/**
 * Finds the cloud id of the configured site among the sites the person allowed
 * on the consent screen. Fails, naming the sites that were allowed, when the
 * site is not one of them.
 */
export async function findCloudId(
  context: Pick<CommandContext, 'fetch' | 'signal'>,
  accessToken: string,
  site: ServerUrl,
): Promise<string> {
  const http = new HttpClient({
    baseUrl: API_GATEWAY,
    fetch: context.fetch,
    signal: context.signal,
    auth: bearerAuth(accessToken),
    userAgent: 'sdlc-jira',
    context: { reauth: [`Sign in again with \`${OAUTH_LOGIN_COMMAND}\`.`] },
  });
  const { data } = await http.get('/oauth/token/accessible-resources', {
    resource: 'the list of sites you allowed',
  });
  const resources = Array.isArray(data) ? data.filter(isResource) : [];

  const match = resources.find((resource) => originOf(resource.url) === site.origin);
  if (match !== undefined) return match.id;

  const granted = resources.map((resource) => resource.url);
  throw new CliError('auth', `The sign-in did not allow access to ${site.host}.`, {
    code: 'site_not_granted',
    causes: [
      'You chose another site on the Atlassian consent screen.',
      'The configured site address is not the address of your Atlassian site.',
    ],
    next: [
      granted.length === 0
        ? 'Atlassian reported no allowed site.'
        : `Allowed sites: ${granted.join(', ')}.`,
      `Run \`${OAUTH_LOGIN_COMMAND}\` again and select ${site.host} when Atlassian asks which site to allow.`,
      'Check the --site value or the "site" setting.',
    ],
    details: { allowed: granted },
  });
}
