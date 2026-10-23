import {
  CliError,
  basicAuth,
  bearerAuth,
  defineCommand,
  defineGroup,
  deleteCredential,
  loginWithPkce,
  readSecret,
  saveCredential,
  type CommandContext,
  type CommandResult,
} from '@sdlc-tools/core';
import { JiraClient } from '../client.js';
import {
  EMAIL_ENV,
  LOGIN_COMMAND,
  OAUTH_REAUTH,
  TOKEN_ENV,
  connect,
  connectionOptions,
  createHttp,
  credentialTarget,
  resolveOAuthSettings,
  resolveSite,
  type SiteTarget,
} from '../connection.js';
import {
  CALLBACK_PATH,
  OAUTH_AUTHORIZATION_PARAMETERS,
  OAUTH_LOGIN_COMMAND,
  OAUTH_SCOPES,
  atlassianClient,
  callbackUrl,
  deleteOAuthApp,
  findCloudId,
  gatewayBaseUrl,
  saveOAuthApp,
} from '../oauth.js';

const TOKEN_LABEL = 'API token';
const SECRET_LABEL = 'client secret';

const iso = (ms: number | undefined): string | null =>
  ms === undefined ? null : new Date(ms).toISOString();

/**
 * The token never travels on the command line. `--with-token` reads it from
 * standard input; otherwise the environment variable wins, then a hidden
 * prompt when standard input is a terminal. Standard input is only read when
 * asked for, so a caller whose input never ends is not left waiting.
 */
async function obtainToken(context: CommandContext, withToken: boolean): Promise<string> {
  if (withToken) return readSecret(context, { label: TOKEN_LABEL });
  const fromEnvironment = context.env[TOKEN_ENV];
  if (fromEnvironment !== undefined && fromEnvironment !== '') return fromEnvironment;
  if (context.stdin.isTTY) return readSecret(context, { label: TOKEN_LABEL });
  throw new CliError(
    'usage',
    `Missing the API token: ${TOKEN_ENV} is not set and standard input is not a terminal.`,
    {
      code: 'missing_token',
      next: [
        'Create an API token in your Atlassian account under Security, then API tokens.',
        `Run \`${LOGIN_COMMAND}\` in a terminal to be asked for it without the input being shown.`,
        `Or pipe it in: \`<command that prints the token> | ${LOGIN_COMMAND} --with-token\`.`,
        `Or export it without echoing it: read -rs ${TOKEN_ENV} && export ${TOKEN_ENV}`,
      ],
    },
  );
}

/**
 * The OAuth client secret never travels on the command line either, and has no environment
 * variable: a terminal gets a hidden prompt, and a pipe has to ask for it with
 * `--client-secret-stdin`.
 */
async function obtainClientSecret(context: CommandContext, fromStdin: boolean): Promise<string> {
  if (fromStdin || context.stdin.isTTY) {
    return readSecret(context, { label: SECRET_LABEL, prompt: 'Client secret: ' });
  }
  throw new CliError('usage', 'Missing the client secret: standard input is not a terminal.', {
    code: 'missing_client_secret',
    next: [
      `Run \`${OAUTH_LOGIN_COMMAND}\` in a terminal to be asked for it without the input being shown.`,
      `Or pipe it in: \`<command that prints the secret> | ${OAUTH_LOGIN_COMMAND} --client-secret-stdin\`.`,
    ],
  });
}

interface LoginFlags {
  readonly oauth: boolean;
  readonly email: string | undefined;
  readonly withToken: boolean;
  readonly clientId: string | undefined;
  readonly callbackPort: string | undefined;
  readonly clientSecretStdin: boolean;
}

/** Each sign-in method has its own flags; mixing them would silently ignore some. */
function rejectMixedFlags(flags: LoginFlags): void {
  const tokenOnly = [
    flags.email !== undefined ? '--email' : undefined,
    flags.withToken ? '--with-token' : undefined,
  ].filter((flag) => flag !== undefined);
  const oauthOnly = [
    flags.clientId !== undefined ? '--client-id' : undefined,
    flags.callbackPort !== undefined ? '--callback-port' : undefined,
    flags.clientSecretStdin ? '--client-secret-stdin' : undefined,
  ].filter((flag) => flag !== undefined);

  if (flags.oauth && tokenOnly.length > 0) {
    const used = tokenOnly.join(' and ');
    throw new CliError('usage', `--oauth cannot be combined with ${used}.`, {
      code: 'conflicting_options',
      next: [`${used} belong to the API token sign-in. Drop ${used}, or drop --oauth.`],
    });
  }
  if (!flags.oauth && oauthOnly.length > 0) {
    const used = oauthOnly.join(' and ');
    throw new CliError('usage', `${used} can only be used with --oauth.`, {
      code: 'conflicting_options',
      next: [`Add --oauth to sign in with OAuth, or drop ${used}.`],
    });
  }
}

/**
 * Signs in through the browser: the app's client secret is taken, the person approves the request
 * for the configured site, and the sign-in only counts once the API gateway accepts the token it
 * produced. The tokens, the client secret and the site's cloud id are then kept in the keychain.
 */
async function loginWithOAuth(
  context: CommandContext,
  target: SiteTarget,
  flags: LoginFlags,
): Promise<CommandResult> {
  const settings = await resolveOAuthSettings(context, flags);
  const clientSecret = await obtainClientSecret(context, flags.clientSecretStdin);
  const client = atlassianClient({ clientId: settings.clientId, clientSecret });

  let tokens;
  try {
    tokens = await loginWithPkce(context, {
      client,
      scopes: OAUTH_SCOPES,
      port: settings.callbackPort,
      callbackPath: CALLBACK_PATH,
      pkce: false,
      extraParams: OAUTH_AUTHORIZATION_PARAMETERS,
    });
  } catch (error) {
    // Atlassian answers a callback URL it does not know with its own error page and never calls back.
    if (error instanceof CliError && error.code === 'login_timeout') {
      throw error.with({
        causes: [
          `The callback URL of the OAuth app is not exactly ${callbackUrl(settings.callbackPort)}.`,
        ],
      });
    }
    throw error;
  }

  const { site } = target;
  const cloudId = await findCloudId(context, tokens.accessToken, site);
  const me = await new JiraClient(
    createHttp(
      context,
      gatewayBaseUrl(cloudId),
      bearerAuth(tokens.accessToken),
      OAUTH_REAUTH,
      site.host,
    ),
    site.baseUrl,
  ).myself();

  const owner = credentialTarget(target);
  await saveOAuthApp(context, owner, { clientId: settings.clientId, clientSecret, cloudId });
  await saveCredential(context, owner, { kind: 'oauth', ...tokens });
  return {
    data: {
      site: site.baseUrl,
      profile: target.profile ?? 'default',
      kind: 'oauth',
      accountId: me.accountId,
      displayName: me.displayName,
      email: me.emailAddress ?? null,
      expiresAt: iso(tokens.expiresAt),
      storage: 'keychain',
    },
    text: `Signed in to ${site.host} as ${me.displayName} with OAuth. The tokens and the client secret are stored in the keychain.`,
  };
}

const login = defineCommand({
  name: 'login',
  summary: 'Sign in with OAuth in the browser, or check an API token and store it',
  description: [
    'Without --oauth, takes the API token from standard input with --with-token, from the',
    `${TOKEN_ENV} environment variable, or, in a terminal, from a prompt that does not show what you`,
    'type. It never appears in the command line or the shell history. The token is verified against the',
    'site before it is stored in the OS keychain, together with the e-mail address of the account that owns it.',
    'With --oauth, signs in with OAuth 2.0 (3LO) in the browser. The OAuth app has to be created in the',
    'Atlassian developer console first, with the resource-level grant, the classic scopes read:jira-work,',
    'write:jira-work and read:jira-user, and the callback URL http://127.0.0.1:<port>/callback. Its client id',
    'and that port come from the settings clientId and callbackPort (or --client-id and --callback-port);',
    'its client secret is typed at a prompt that does not show it, or piped in with --client-secret-stdin,',
    'and is kept in the keychain only. Tokens are renewed automatically.',
  ].join(' '),
  options: {
    ...connectionOptions,
    email: {
      type: 'string',
      valueName: 'address',
      description: `E-mail address of the Atlassian account (or ${EMAIL_ENV})`,
    },
    withToken: {
      type: 'boolean',
      description:
        'Read the API token from standard input (typed without echo in a terminal) instead of the environment',
    },
    oauth: {
      type: 'boolean',
      description: 'Sign in with OAuth 2.0 (3LO) in the browser instead of an API token',
    },
    clientId: {
      type: 'string',
      valueName: 'id',
      description: 'Client id of the OAuth app, with --oauth (or SDLC_JIRA_CLIENT_ID)',
    },
    callbackPort: {
      type: 'string',
      valueName: 'port',
      description:
        "Port of the OAuth app's callback URL on 127.0.0.1, with --oauth (or SDLC_JIRA_CALLBACK_PORT)",
    },
    clientSecretStdin: {
      type: 'boolean',
      description:
        'Read the OAuth client secret from standard input (typed without echo in a terminal), with --oauth',
    },
  },
  examples: [
    'sdlc-jira auth login --site your-team.atlassian.net --email you@example.com',
    '<command that prints the token> | sdlc-jira auth login --site your-team.atlassian.net --email you@example.com --with-token',
    'sdlc-jira auth login --oauth --site your-team.atlassian.net --client-id <id> --callback-port 8766',
    '<command that prints the secret> | sdlc-jira auth login --oauth --site your-team.atlassian.net --client-secret-stdin',
  ],
  async run({ options }, context) {
    rejectMixedFlags(options);
    const target = await resolveSite(context, options);
    if (options.oauth) return loginWithOAuth(context, target, options);

    const email = options.email ?? context.env[EMAIL_ENV];
    if (!email?.includes('@')) {
      throw new CliError('usage', 'Missing the account e-mail address.', {
        code: 'missing_email',
        next: ['Pass --email you@example.com.', `Or set the ${EMAIL_ENV} environment variable.`],
      });
    }
    const token = await obtainToken(context, options.withToken);

    const http = createHttp(context, target.site.baseUrl, basicAuth(email, token), [
      `The e-mail address or the API token is wrong, or the token has expired.`,
      `Create a new token and enter it again, or export it as ${TOKEN_ENV}.`,
    ]);
    const me = await new JiraClient(http, target.site.baseUrl).myself();

    const owner = credentialTarget(target);
    await saveCredential(context, owner, { kind: 'token', token, username: email });
    // An OAuth sign-in this replaces must not leave its client secret behind.
    await deleteOAuthApp(context, owner);
    return {
      data: {
        site: target.site.baseUrl,
        profile: target.profile ?? 'default',
        accountId: me.accountId,
        displayName: me.displayName,
        email,
        storage: 'keychain',
      },
      text: `Signed in to ${target.site.host} as ${me.displayName} (${email}). The token is stored in the keychain.`,
    };
  },
});

const status = defineCommand({
  name: 'status',
  summary: 'Show which account the stored or environment credentials belong to',
  description:
    'Asks the site who the credentials belong to, and shows how you are signed in (an OAuth sign-in or an API token) and, for OAuth, when the current access token expires. The token is renewed before it does, so the date moves on.',
  options: connectionOptions,
  async run({ options }, context) {
    const connection = await connect(context, options);
    const me = await connection.client.myself();
    // Read after the request: the session may have renewed the token to make it.
    const expiresAt = iso(connection.session?.credential.expiresAt);
    const where = connection.source === 'env' ? 'environment' : 'keychain';
    const as =
      connection.kind === 'oauth'
        ? `${me.displayName} with OAuth${expiresAt === null ? '' : ` (access token valid until ${expiresAt}, renewed automatically)`}`
        : `${me.displayName} (${connection.email}) with an API token`;
    return {
      data: {
        site: connection.site.baseUrl,
        profile: connection.profile ?? 'default',
        kind: connection.kind,
        accountId: me.accountId,
        displayName: me.displayName,
        email: connection.email ?? me.emailAddress ?? null,
        source: connection.source,
        expiresAt,
      },
      text: `Signed in to ${connection.site.host} as ${as}, credentials from the ${where}.`,
    };
  },
});

const logout = defineCommand({
  name: 'logout',
  summary: 'Remove the stored credentials for a site, including an OAuth client secret',
  options: connectionOptions,
  async run({ options }, context) {
    const target = await resolveSite(context, options);
    const owner = credentialTarget(target);
    const [credential, app] = await Promise.all([
      deleteCredential(context, owner),
      deleteOAuthApp(context, owner),
    ]);
    const removed = credential || app;
    return {
      data: { site: target.site.baseUrl, profile: target.profile ?? 'default', removed },
      text: removed
        ? `Removed the stored credentials for ${target.site.host}.`
        : `No stored credentials for ${target.site.host}.`,
    };
  },
});

export const auth = defineGroup({
  name: 'auth',
  summary: 'Sign in, check and sign out',
  commands: [login, status, logout],
});
