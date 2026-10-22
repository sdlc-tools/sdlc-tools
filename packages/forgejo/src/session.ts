import {
  CliError,
  HttpClient,
  OAuthSession,
  bearerAuth,
  credentialAccount,
  deleteCredential,
  normalizeServerUrl,
  resolveCredential,
  toolEnvVar,
  type AuthProvider,
  type CommandContext,
  type CredentialTarget,
  type OAuthClient,
  type ResolvedCredential,
  type ServerUrl,
} from '@sdlc-tools/core';
import { ForgejoApi } from './api.js';
import { LOGIN_COMMAND, TOOL } from './settings.js';

/** The OAuth application a sign-in used is kept next to the credential so that renewing needs no configuration. */
const CLIENT_TOOL = 'forgejo-client';

export const TOKEN_ENV = toolEnvVar(TOOL, 'token');

export interface ConnectionSettings {
  readonly host: string;
  readonly profile: string | undefined;
  readonly clientId: string | undefined;
}

export interface Session {
  readonly server: ServerUrl;
  readonly target: CredentialTarget;
  readonly api: ForgejoApi;
  readonly resolved: ResolvedCredential;
  /** Present when the credential is an OAuth sign-in; reading it after a request shows the renewed tokens. */
  readonly oauth: OAuthSession | undefined;
}

export function targetFor(settings: ConnectionSettings): {
  server: ServerUrl;
  target: CredentialTarget;
} {
  const server = normalizeServerUrl(settings.host, 'Forgejo server address');
  return { server, target: { tool: TOOL, origin: server.origin, profile: settings.profile } };
}

const clientAccount = (target: CredentialTarget): string =>
  credentialAccount({ ...target, tool: CLIENT_TOOL });

export async function saveClientId(
  context: Pick<CommandContext, 'store'>,
  target: CredentialTarget,
  clientId: string,
): Promise<void> {
  await context.store.set(clientAccount(target), clientId);
}

export async function forgetClientId(
  context: Pick<CommandContext, 'store'>,
  target: CredentialTarget,
): Promise<boolean> {
  return context.store.delete(clientAccount(target));
}

export function oauthEndpoints(
  server: ServerUrl,
  clientId: string,
): OAuthClient & { readonly authorizationEndpoint: string } {
  return {
    clientId,
    authorizationEndpoint: `${server.baseUrl}/login/oauth/authorize`,
    tokenEndpoint: `${server.baseUrl}/login/oauth/access_token`,
  };
}

export function createApi(
  context: Pick<CommandContext, 'fetch' | 'signal'>,
  server: ServerUrl,
  auth: AuthProvider,
): ForgejoApi {
  return new ForgejoApi(
    new HttpClient({
      baseUrl: `${server.baseUrl}/api/v1`,
      fetch: context.fetch,
      signal: context.signal,
      auth,
      context: { server: server.host, reauth: [`Sign in with \`${LOGIN_COMMAND}\`.`] },
    }),
  );
}

/**
 * Finds the credential for the configured server and returns an API client that uses it. Every
 * failure here (no credential, a keychain that cannot be read, an OAuth sign-in with no known
 * application) happens before the first request.
 */
export async function openSession(
  context: CommandContext,
  settings: ConnectionSettings,
): Promise<Session> {
  const { server, target } = targetFor(settings);
  const resolved = await resolveCredential(context, {
    ...target,
    tokenEnv: TOKEN_ENV,
    loginCommand: LOGIN_COMMAND,
  });

  const { credential } = resolved;
  if (credential.kind === 'token') {
    return {
      server,
      target,
      api: createApi(context, server, bearerAuth(credential.token)),
      resolved,
      oauth: undefined,
    };
  }

  const clientId =
    settings.clientId ?? (await context.store.get(clientAccount(target))) ?? undefined;
  if (clientId === undefined) {
    throw new CliError(
      'auth',
      'The stored sign-in does not say which OAuth application issued it.',
      {
        code: 'oauth_client_unknown',
        next: [`Sign in again with \`${LOGIN_COMMAND}\`.`],
      },
    );
  }
  const oauth = new OAuthSession({
    runtime: context,
    target,
    client: oauthEndpoints(server, clientId),
    credential,
    loginCommand: LOGIN_COMMAND,
  });
  return { server, target, api: createApi(context, server, oauth), resolved, oauth };
}

/** Removes the stored sign-in and the record of the application behind it. */
export async function forgetSession(
  context: Pick<CommandContext, 'store'>,
  target: CredentialTarget,
): Promise<boolean> {
  const [removed] = await Promise.all([
    deleteCredential(context, target),
    forgetClientId(context, target),
  ]);
  return removed;
}
