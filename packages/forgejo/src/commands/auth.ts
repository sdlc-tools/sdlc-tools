import {
  CliError,
  bearerAuth,
  defineCommand,
  defineGroup,
  loginWithPkce,
  saveCredential,
  type OAuthCredential,
} from '@sdlc-tools/core';
import {
  createApi,
  forgetClientId,
  forgetSession,
  oauthEndpoints,
  openSession,
  saveClientId,
  targetFor,
  TOKEN_ENV,
} from '../session.js';
import { LOGIN_COMMAND, resolveToolSettings } from '../settings.js';
import { serverOptions } from './shared.js';

const UNREGISTERED_REDIRECT_HINT =
  'If the browser shows "Unregistered Redirect URI", the OAuth application is probably a confidential client, ' +
  'for which the server compares the redirect address including its port. Either register it as a public client ' +
  '(Confidential client off; where that option sits depends on the server), or register the redirect ' +
  'address http://127.0.0.1:<port>/callback with a fixed port (exactly that text, not localhost) and run ' +
  '`auth login --callback-port <port>` with that same port.';

const iso = (ms: number | undefined): string | null =>
  ms === undefined ? null : new Date(ms).toISOString();

export function authGroup() {
  const login = defineCommand({
    name: 'login',
    summary: 'Sign in with OAuth, or store a personal access token',
    description: [
      'Signs in with the OAuth 2.0 authorization code grant and PKCE: a browser window opens, you approve',
      'the request, and the tokens are kept in the operating system keychain and renewed automatically.',
      'The OAuth application has to be registered on the server first (Settings, Applications), as a',
      'public client whose redirect address is http://127.0.0.1:<port>/callback.',
      '',
      'With --with-token the command instead reads a personal access token from standard input.',
    ].join('\n'),
    options: {
      ...serverOptions,
      clientId: {
        type: 'string',
        valueName: 'id',
        description: 'Client id of the registered OAuth application (SDLC_FORGEJO_CLIENT_ID)',
      },
      callbackPort: {
        type: 'string',
        valueName: 'port',
        description:
          'Fixed port for the local callback, when the application registers an exact address',
      },
      scopes: {
        type: 'string',
        valueName: 'list',
        description: 'Scopes to request, separated by commas or spaces (omitted by default)',
      },
      withToken: {
        type: 'boolean',
        description: 'Read a personal access token from standard input instead of using OAuth',
      },
    },
    examples: [
      'sdlc-forgejo auth login --host https://git.example.com --client-id <id>',
      'printf %s "$TOKEN" | sdlc-forgejo auth login --host https://git.example.com --with-token',
    ],
    async run({ options }, context) {
      const { values } = await resolveToolSettings(
        context,
        ['host', 'profile', 'clientId', 'callbackPort', 'scopes'],
        {
          host: options.host,
          profile: options.profile,
          clientId: options.clientId,
          callbackPort: options.callbackPort,
          scopes: options.scopes,
        },
      );
      const { server, target } = targetFor(values);

      if (options.withToken) {
        context.log('Reading the access token from standard input.');
        const token = (await context.stdin.readAll()).trim();
        if (token === '' || /\s/.test(token)) {
          throw new CliError('usage', 'Standard input did not hold a single access token.', {
            code: 'invalid_token_input',
            next: [
              `Pipe the token in, for example: printf %s "$TOKEN" | ${LOGIN_COMMAND} --with-token`,
            ],
          });
        }
        const user = await createApi(context, server, bearerAuth(token)).currentUser();
        await saveCredential(context, target, { kind: 'token', token });
        await forgetClientId(context, target);
        return {
          data: { host: server.baseUrl, login: user.login, kind: 'token', expiresAt: null },
          text: `Signed in to ${server.baseUrl} as ${user.login} with an access token.`,
        };
      }

      if (values.clientId === undefined) {
        throw new CliError('config', 'Missing OAuth client id.', {
          code: 'missing_setting',
          causes: ['OAuth sign-in needs an application registered on the server.'],
          next: [
            'Register an OAuth application (Settings, Applications) as a public client with the redirect address http://127.0.0.1:<port>/callback.',
            'Pass --client-id, set SDLC_FORGEJO_CLIENT_ID, or add "clientId" under "forgejo" in the user configuration file.',
            'Or sign in with a personal access token using --with-token.',
          ],
        });
      }

      const scopes = (values.scopes ?? '').split(/[\s,]+/).filter((scope) => scope !== '');
      const tokens = await loginWithPkce(context, {
        stallHint: UNREGISTERED_REDIRECT_HINT,
        client: oauthEndpoints(server, values.clientId),
        ...(scopes.length === 0 ? {} : { scopes }),
        ...(values.callbackPort === undefined ? {} : { port: Number(values.callbackPort) }),
      });

      // The sign-in only counts once the REST API accepts the token it produced.
      const user = await createApi(context, server, bearerAuth(tokens.accessToken)).currentUser();
      const credential: OAuthCredential = {
        kind: 'oauth',
        accessToken: tokens.accessToken,
        tokenType: tokens.tokenType,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt,
        scope: tokens.scope,
      };
      await saveCredential(context, target, credential);
      await saveClientId(context, target, values.clientId);
      return {
        data: {
          host: server.baseUrl,
          login: user.login,
          kind: 'oauth',
          expiresAt: iso(tokens.expiresAt),
          renewable: tokens.refreshToken !== undefined,
        },
        text: `Signed in to ${server.baseUrl} as ${user.login} with OAuth.`,
      };
    },
  });

  const status = defineCommand({
    name: 'status',
    summary: 'Show who you are signed in as',
    description:
      'Asks the server who the stored credentials belong to. Exits with code 3 when you are not signed in.',
    options: { ...serverOptions },
    async run({ options }, context) {
      const { values } = await resolveToolSettings(context, ['host', 'profile', 'clientId'], {
        host: options.host,
        profile: options.profile,
        clientId: undefined,
      });
      const session = await openSession(context, values);
      const user = await session.api.currentUser();
      const credential = session.oauth?.credential ?? session.resolved.credential;
      const expiresAt = credential.kind === 'oauth' ? credential.expiresAt : undefined;
      return {
        data: {
          host: session.server.baseUrl,
          profile: session.target.profile ?? 'default',
          login: user.login,
          kind: credential.kind,
          source: session.resolved.source,
          expiresAt: iso(expiresAt),
        },
        text: `Signed in to ${session.server.baseUrl} as ${user.login} (${credential.kind}, from the ${session.resolved.source === 'env' ? TOKEN_ENV + ' variable' : 'keychain'}).`,
      };
    },
  });

  const logout = defineCommand({
    name: 'logout',
    summary: 'Forget the stored credentials for a server',
    description:
      'Removes the credentials from the keychain. The server keeps the access token until it expires; revoke it under Settings, Applications to invalidate it at once.',
    options: { ...serverOptions },
    async run({ options }, context) {
      const { values } = await resolveToolSettings(context, ['host', 'profile'], {
        host: options.host,
        profile: options.profile,
      });
      const { server, target } = targetFor({ ...values, clientId: undefined });
      const removed = await forgetSession(context, target);
      return {
        data: { host: server.baseUrl, removed },
        text: removed
          ? `Signed out of ${server.baseUrl}.`
          : `No stored credentials for ${server.baseUrl}.`,
      };
    },
  });

  return defineGroup({
    name: 'auth',
    summary: 'Sign in and out',
    commands: [login, status, logout],
  });
}
