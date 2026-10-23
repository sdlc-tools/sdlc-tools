import { CliError } from '../errors.js';
import { describeNetworkError, extractServerMessage, translateHttpError } from '../http.js';
import type { Runtime } from '../runtime.js';

export interface OAuthClient {
  readonly tokenEndpoint: string;
  readonly clientId: string;
  /**
   * Authenticates a confidential client at the token endpoint as the
   * `client_secret` body parameter (RFC 6749 §2.3.1). Public clients leave it
   * unset and rely on PKCE instead. It is sent only to `tokenEndpoint`.
   */
  readonly clientSecret?: string | undefined;
  /**
   * How token requests are encoded: the form body RFC 6749 §4.1.3 specifies by
   * default, or `json` for servers that document a JSON body.
   */
  readonly tokenRequestFormat?: 'form' | 'json' | undefined;
}

export interface OAuthTokens {
  readonly accessToken: string;
  readonly tokenType: string;
  readonly refreshToken?: string | undefined;
  /** Milliseconds since the Unix epoch, computed from `expires_in` when the server sent it. */
  readonly expiresAt?: number | undefined;
  readonly scope?: string | undefined;
}

export type TokenRuntime = Pick<Runtime, 'fetch' | 'now' | 'signal'>;

const REQUEST_TIMEOUT_MS = 30_000;

const OAUTH_ERROR_ADVICE: Readonly<Record<string, { causes: string[]; next: string[] }>> = {
  invalid_grant: {
    causes: [
      'The authorization code or refresh token was already used, has expired, or was revoked.',
      'The redirect address differs from the one used to start the sign-in.',
    ],
    next: ['Sign in again.'],
  },
  invalid_client: {
    causes: [
      'The OAuth application (client id) is not registered on this server, or was deleted.',
      'The client is registered as confidential but is used as a public client.',
    ],
    next: ['Check the configured OAuth client id and server address.'],
  },
  unauthorized_client: {
    causes: ['The OAuth application is not allowed to use this grant type.'],
    next: ['Check the OAuth application settings on the server.'],
  },
  invalid_scope: {
    causes: ['A requested scope does not exist or is not allowed for this application.'],
    next: ['Check the configured scopes.'],
  },
  invalid_request: {
    causes: ['The server rejected a parameter of the request.'],
    next: ['Check the configured redirect address and OAuth endpoints.'],
  },
};

/** The OAuth `error` code (such as `invalid_grant`) behind an error from this module, if any. */
export function oauthErrorCode(error: unknown): string | undefined {
  if (!(error instanceof CliError)) return undefined;
  const code = error.details?.oauthError;
  return typeof code === 'string' ? code : undefined;
}

async function postToken(
  runtime: TokenRuntime,
  client: OAuthClient,
  parameters: Record<string, string>,
  purpose: string,
): Promise<OAuthTokens> {
  const endpoint = new URL(client.tokenEndpoint);
  const fields =
    client.clientSecret === undefined
      ? parameters
      : { ...parameters, client_secret: client.clientSecret };
  const json = client.tokenRequestFormat === 'json';
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const signal =
    runtime.signal === undefined ? timeout : AbortSignal.any([timeout, runtime.signal]);

  let status: number;
  let text: string;
  try {
    const response = await runtime.fetch(endpoint, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': json ? 'application/json' : 'application/x-www-form-urlencoded',
      },
      body: json ? JSON.stringify(fields) : new URLSearchParams(fields).toString(),
      signal,
    });
    status = response.status;
    text = await response.text();
  } catch (error) {
    if (runtime.signal?.aborted === true) {
      throw new CliError('cancelled', 'Cancelled.', { cause: error });
    }
    throw describeNetworkError(
      error,
      endpoint.host,
      timeout.aborted ? REQUEST_TIMEOUT_MS : undefined,
    );
  }

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = undefined;
  }
  const record =
    typeof body === 'object' && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : undefined;

  if (status >= 200 && status < 300)
    return parseTokenResponse(record, runtime.now(), endpoint.host);

  const oauthError = typeof record?.error === 'string' ? record.error : undefined;
  if (oauthError !== undefined) {
    const description =
      typeof record?.error_description === 'string' ? record.error_description : undefined;
    const advice = OAUTH_ERROR_ADVICE[oauthError];
    return Promise.reject(
      new CliError(
        'auth',
        `${endpoint.host} refused the ${purpose}: ${description ?? oauthError} (${oauthError}).`,
        {
          code: `oauth_${oauthError}`,
          status,
          details: { oauthError, server: endpoint.host },
          ...advice,
        },
      ),
    );
  }

  return Promise.reject(
    translateHttpError({
      status,
      server: endpoint.host,
      resource: 'the token endpoint',
      reauth: ['Check the configured OAuth client id and token endpoint.'],
      serverMessage: extractServerMessage(body ?? text),
    }),
  );
}

function parseTokenResponse(
  record: Record<string, unknown> | undefined,
  now: number,
  server: string,
): OAuthTokens {
  const accessToken = record?.access_token;
  if (typeof accessToken !== 'string' || accessToken === '') {
    throw new CliError('server', `${server} returned a token response without an access token.`, {
      code: 'invalid_token_response',
      next: ['Check that the configured token endpoint is an OAuth 2.0 token endpoint.'],
    });
  }
  const tokenType = typeof record?.token_type === 'string' ? record.token_type : 'bearer';
  const refreshToken =
    typeof record?.refresh_token === 'string' && record.refresh_token !== ''
      ? record.refresh_token
      : undefined;
  const expiresIn = record?.expires_in;
  const scope = typeof record?.scope === 'string' && record.scope !== '' ? record.scope : undefined;
  return {
    accessToken,
    tokenType,
    ...(refreshToken === undefined ? {} : { refreshToken }),
    ...(typeof expiresIn === 'number' && Number.isFinite(expiresIn) && expiresIn > 0
      ? { expiresAt: now + expiresIn * 1000 }
      : {}),
    ...(scope === undefined ? {} : { scope }),
  };
}

/**
 * Exchanges an authorization code for tokens (RFC 6749 §4.1.3). A sign-in that
 * used PKCE proves possession of its verifier (RFC 7636 §4.5); one that did not
 * leaves `codeVerifier` out.
 */
export function exchangeAuthorizationCode(
  runtime: TokenRuntime,
  client: OAuthClient,
  grant: {
    readonly code: string;
    readonly redirectUri: string;
    readonly codeVerifier?: string | undefined;
  },
): Promise<OAuthTokens> {
  return postToken(
    runtime,
    client,
    {
      grant_type: 'authorization_code',
      code: grant.code,
      redirect_uri: grant.redirectUri,
      client_id: client.clientId,
      ...(grant.codeVerifier === undefined ? {} : { code_verifier: grant.codeVerifier }),
    },
    'authorization code',
  );
}

/**
 * Obtains new tokens with a refresh token (RFC 6749 §6). When the server does
 * not issue a new refresh token the current one stays valid and is carried over.
 */
export async function refreshAccessToken(
  runtime: TokenRuntime,
  client: OAuthClient,
  refreshToken: string,
): Promise<OAuthTokens> {
  const tokens = await postToken(
    runtime,
    client,
    { grant_type: 'refresh_token', refresh_token: refreshToken, client_id: client.clientId },
    'refresh token',
  );
  return tokens.refreshToken === undefined ? { ...tokens, refreshToken } : tokens;
}
