import {
  CliError,
  basicAuth,
  defineCommand,
  defineGroup,
  deleteCredential,
  readSecret,
  saveCredential,
  type CommandContext,
} from '@sdlc-tools/core';
import { JiraClient } from '../client.js';
import {
  EMAIL_ENV,
  LOGIN_COMMAND,
  TOKEN_ENV,
  TOOL,
  connect,
  connectionOptions,
  createHttp,
  resolveSite,
} from '../connection.js';

const TOKEN_LABEL = 'API token';

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

const login = defineCommand({
  name: 'login',
  summary: 'Check an API token and store it in the OS keychain',
  description: [
    'Takes the API token from standard input with --with-token, from the',
    `${TOKEN_ENV} environment variable, or, in a terminal, from a prompt that does not show what you`,
    'type. It never appears in the command line or the shell history. The token is verified against the',
    'site before it is stored, together with the e-mail address of the account that owns it.',
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
  },
  examples: [
    'sdlc-jira auth login --site your-team.atlassian.net --email you@example.com',
    '<command that prints the token> | sdlc-jira auth login --site your-team.atlassian.net --email you@example.com --with-token',
  ],
  async run({ options }, context) {
    const target = await resolveSite(context, options);
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

    await saveCredential(
      context,
      { tool: TOOL, origin: target.site.origin, profile: target.profile },
      { kind: 'token', token, username: email },
    );
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
  options: connectionOptions,
  async run({ options }, context) {
    const connection = await connect(context, options);
    const me = await connection.client.myself();
    return {
      data: {
        site: connection.site.baseUrl,
        profile: connection.profile ?? 'default',
        accountId: me.accountId,
        displayName: me.displayName,
        email: connection.email,
        source: connection.source,
      },
      text: `Signed in to ${connection.site.host} as ${me.displayName} (${connection.email}), credentials from the ${connection.source === 'env' ? 'environment' : 'keychain'}.`,
    };
  },
});

const logout = defineCommand({
  name: 'logout',
  summary: 'Remove the stored credentials for a site',
  options: connectionOptions,
  async run({ options }, context) {
    const target = await resolveSite(context, options);
    const removed = await deleteCredential(context, {
      tool: TOOL,
      origin: target.site.origin,
      profile: target.profile,
    });
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
