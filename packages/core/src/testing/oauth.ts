import { computeCodeChallenge } from '../oauth/pkce.js';
import type { OAuthClient } from '../oauth/tokens.js';
import { jsonResponse, mockFetch, type MockFetch } from './fetch.js';

export interface AuthorizationRequest {
  readonly redirectUri: string;
  readonly state: string;
  readonly codeChallenge: string;
  readonly codeChallengeMethod: string;
  readonly clientId: string;
  readonly scope: string | undefined;
  readonly responseType: string;
  /** Every query parameter of the authorization request, for parameters a server adds such as `audience`. */
  readonly parameters: Readonly<Record<string, string>>;
}

export interface FakeAuthorizationServerOptions {
  readonly clientId?: string;
  /**
   * Makes the client confidential: token requests must carry this
   * `client_secret`, and PKCE is not required, as on servers that do not
   * document it.
   */
  readonly clientSecret?: string;
  /** Refuse token requests that are not encoded this way; both are accepted when unset. */
  readonly tokenRequestFormat?: 'form' | 'json';
  readonly authorizationEndpoint?: string;
  readonly tokenEndpoint?: string;
  readonly expiresInSeconds?: number;
  /** Issue a new refresh token on every refresh and retire the old one. Defaults to true. */
  readonly rotateRefreshTokens?: boolean;
}

/**
 * An OAuth 2.0 server in memory that enforces what a real one does: the
 * authorization code is single use and bound to the redirect address and client,
 * the PKCE verifier must hash to the challenge sent at authorization time, and
 * rotated refresh tokens cannot be replayed.
 *
 * Hand `fetch` to the runtime under test for the token endpoint and `openUrl`
 * as the browser: it approves the authorization request by calling the
 * loopback redirect address, exactly as a browser would.
 */
export class FakeAuthorizationServer {
  readonly client: OAuthClient & { readonly authorizationEndpoint: string };
  readonly fetch: MockFetch;
  readonly authorizations: AuthorizationRequest[] = [];
  /** Form bodies received by the token endpoint. */
  readonly tokenRequests: Record<string, string>[] = [];

  readonly #expiresIn: number;
  readonly #rotate: boolean;
  #clientSecret: string | undefined;
  readonly #tokenRequestFormat: 'form' | 'json' | undefined;
  readonly #codes = new Map<string, AuthorizationRequest>();
  readonly #refreshTokens = new Set<string>();
  #issued = 0;
  #failNext: { status: number; body: unknown } | undefined;

  constructor(options: FakeAuthorizationServerOptions = {}) {
    this.client = {
      clientId: options.clientId ?? 'test-client',
      ...(options.clientSecret === undefined ? {} : { clientSecret: options.clientSecret }),
      ...(options.tokenRequestFormat === undefined
        ? {}
        : { tokenRequestFormat: options.tokenRequestFormat }),
      authorizationEndpoint:
        options.authorizationEndpoint ?? 'https://auth.example.test/login/oauth/authorize',
      tokenEndpoint: options.tokenEndpoint ?? 'https://auth.example.test/login/oauth/access_token',
    };
    this.#expiresIn = options.expiresInSeconds ?? 3600;
    this.#rotate = options.rotateRefreshTokens ?? true;
    this.#clientSecret = options.clientSecret;
    this.#tokenRequestFormat = options.tokenRequestFormat;
    this.fetch = mockFetch((request) => {
      if (request.url.href !== this.client.tokenEndpoint || request.method !== 'POST') {
        return jsonResponse(404, { message: 'not found' });
      }
      const form = this.#parseBody(request);
      return form === undefined
        ? jsonResponse(400, {
            error: 'invalid_request',
            error_description: `token requests must be ${this.#tokenRequestFormat ?? 'form or json'} encoded`,
          })
        : jsonResponse(...this.#token(form));
    });
  }

  /** Makes the next token request fail with this response. */
  failNextTokenRequest(status: number, body: unknown): void {
    this.#failNext = { status, body };
  }

  /**
   * Simulates regenerating the client secret in the server's console: the old one is refused from
   * now on. `client` keeps the old secret, as a stale configuration would.
   */
  changeClientSecret(secret: string): void {
    this.#clientSecret = secret;
  }

  /** Invalidates every refresh token issued so far. */
  revokeRefreshTokens(): void {
    this.#refreshTokens.clear();
  }

  /** Simulates a user approving the sign-in; `overrides` tamper with the callback query. */
  readonly openUrl = async (url: string): Promise<void> => {
    await this.approve(url);
  };

  /** Calls the redirect address like a browser would and resolves with the page it served. */
  async approve(
    url: string,
    overrides: Readonly<Record<string, string | null>> = {},
  ): Promise<{ status: number; body: string }> {
    const request = parseAuthorizationUrl(url);
    this.authorizations.push(request);
    const code = `code-${this.authorizations.length}`;
    this.#codes.set(code, request);

    const callback = new URL(request.redirectUri);
    const query: Record<string, string | null> = { code, state: request.state, ...overrides };
    for (const [name, value] of Object.entries(query)) {
      if (value !== null) callback.searchParams.set(name, value);
    }
    const response = await fetch(callback);
    return { status: response.status, body: await response.text() };
  }

  /** The request parameters, or `undefined` when the body is not encoded the way this server accepts. */
  #parseBody(request: {
    readonly headers: Headers;
    readonly body: string | undefined;
  }): Record<string, string> | undefined {
    const format = /\bjson\b/i.test(request.headers.get('content-type') ?? '') ? 'json' : 'form';
    if (this.#tokenRequestFormat !== undefined && format !== this.#tokenRequestFormat) {
      return undefined;
    }
    if (format === 'form') return Object.fromEntries(new URLSearchParams(request.body ?? ''));
    try {
      return JSON.parse(request.body ?? '') as Record<string, string>;
    } catch {
      return undefined;
    }
  }

  #token(form: Record<string, string>): [number, unknown] {
    this.tokenRequests.push(form);
    if (this.#failNext !== undefined) {
      const failure = this.#failNext;
      this.#failNext = undefined;
      return [failure.status, failure.body];
    }
    if (form.client_id !== this.client.clientId) {
      return [401, { error: 'invalid_client', error_description: 'unknown client' }];
    }
    if (this.#clientSecret !== undefined && form.client_secret !== this.#clientSecret) {
      return [401, { error: 'invalid_client', error_description: 'client authentication failed' }];
    }

    if (form.grant_type === 'authorization_code') {
      const request = this.#codes.get(form.code ?? '');
      this.#codes.delete(form.code ?? '');
      if (request === undefined) {
        return [400, { error: 'invalid_grant', error_description: 'unknown or used code' }];
      }
      if (form.redirect_uri !== request.redirectUri) {
        return [400, { error: 'invalid_grant', error_description: 'redirect_uri mismatch' }];
      }
      // A confidential client authenticated above; PKCE is checked when it asked for it.
      const pkceRequired = this.#clientSecret === undefined || request.codeChallenge !== '';
      if (
        pkceRequired &&
        (form.code_verifier === undefined ||
          computeCodeChallenge(form.code_verifier) !== request.codeChallenge)
      ) {
        return [400, { error: 'invalid_grant', error_description: 'PKCE verification failed' }];
      }
      return [200, this.#issue(request.scope)];
    }

    if (form.grant_type === 'refresh_token') {
      if (!this.#refreshTokens.has(form.refresh_token ?? '')) {
        return [400, { error: 'invalid_grant', error_description: 'refresh token is not valid' }];
      }
      if (this.#rotate) this.#refreshTokens.delete(form.refresh_token ?? '');
      return [200, this.#issue(undefined)];
    }
    return [400, { error: 'unsupported_grant_type' }];
  }

  #issue(scope: string | undefined): Record<string, unknown> {
    this.#issued += 1;
    const refreshToken = `refresh-${this.#issued}`;
    this.#refreshTokens.add(refreshToken);
    return {
      access_token: `access-${this.#issued}`,
      token_type: 'bearer',
      expires_in: this.#expiresIn,
      refresh_token: refreshToken,
      ...(scope === undefined ? {} : { scope }),
    };
  }
}

function parseAuthorizationUrl(url: string): AuthorizationRequest {
  const { searchParams } = new URL(url);
  const get = (name: string): string => searchParams.get(name) ?? '';
  return {
    redirectUri: get('redirect_uri'),
    state: get('state'),
    codeChallenge: get('code_challenge'),
    codeChallengeMethod: get('code_challenge_method'),
    clientId: get('client_id'),
    scope: searchParams.get('scope') ?? undefined,
    responseType: get('response_type'),
    parameters: Object.fromEntries(searchParams),
  };
}
