import { describe, expect, it } from 'vitest';
import {
  CliError,
  exchangeAuthorizationCode,
  oauthErrorCode,
  refreshAccessToken,
} from '../src/index.js';
import {
  TEST_NOW,
  jsonResponse,
  mockFetch,
  networkFailure,
  textResponse,
  type MockHandler,
} from '../src/testing/index.js';

const client = {
  clientId: 'test-client',
  tokenEndpoint: 'https://auth.example.test/oauth/token',
};

function runtime(handler: MockHandler) {
  const fetch = mockFetch(handler);
  return { fetch, runtime: { fetch: fetch.fetch, now: () => TEST_NOW, signal: undefined } };
}

async function rejection(promise: Promise<unknown>): Promise<CliError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(CliError);
    return error as CliError;
  }
  throw new Error('expected a rejection');
}

describe('refreshAccessToken', () => {
  it('posts the refresh grant for the client and computes the expiry', async () => {
    const { fetch, runtime: rt } = runtime(() =>
      jsonResponse(200, {
        access_token: 'new-access',
        token_type: 'bearer',
        expires_in: 120,
        refresh_token: 'new-refresh',
      }),
    );
    const tokens = await refreshAccessToken(rt, client, 'old-refresh');
    expect(tokens).toEqual({
      accessToken: 'new-access',
      tokenType: 'bearer',
      refreshToken: 'new-refresh',
      expiresAt: TEST_NOW + 120_000,
    });
    const [call] = fetch.calls;
    expect(call?.method).toBe('POST');
    expect(call?.url.href).toBe(client.tokenEndpoint);
    expect(call?.headers.get('content-type')).toBe('application/x-www-form-urlencoded');
    expect(Object.fromEntries(new URLSearchParams(call?.body))).toEqual({
      grant_type: 'refresh_token',
      refresh_token: 'old-refresh',
      client_id: 'test-client',
    });
  });

  it('keeps the current refresh token when the server does not rotate it', async () => {
    const { runtime: rt } = runtime(() =>
      jsonResponse(200, { access_token: 'a', token_type: 'bearer' }),
    );
    const tokens = await refreshAccessToken(rt, client, 'kept');
    expect(tokens.refreshToken).toBe('kept');
    expect(tokens.expiresAt).toBeUndefined();
  });

  it('defaults a missing token type to bearer', async () => {
    const { runtime: rt } = runtime(() => jsonResponse(200, { access_token: 'a' }));
    expect((await refreshAccessToken(rt, client, 'r')).tokenType).toBe('bearer');
  });
});

describe('token endpoint errors', () => {
  it.each([
    ['invalid_grant', /Sign in again/],
    ['invalid_client', /client id/],
    ['invalid_scope', /scopes/],
  ])('translates the OAuth error %s into an auth error with advice', async (code, advice) => {
    const { runtime: rt } = runtime(() =>
      jsonResponse(400, { error: code, error_description: 'details' }),
    );
    const error = await rejection(
      exchangeAuthorizationCode(rt, client, { code: 'c', redirectUri: 'r', codeVerifier: 'v' }),
    );
    expect(error.kind).toBe('auth');
    expect(error.exitCode).toBe(3);
    expect(error.code).toBe(`oauth_${code}`);
    expect(oauthErrorCode(error)).toBe(code);
    expect(error.message).toContain('details');
    expect([...error.causes, ...error.next].join(' ')).toMatch(advice);
  });

  it('keeps unknown OAuth errors as auth errors', async () => {
    const { runtime: rt } = runtime(() => jsonResponse(400, { error: 'weird_error' }));
    const error = await rejection(refreshAccessToken(rt, client, 'r'));
    expect(error.code).toBe('oauth_weird_error');
  });

  it('translates a 404 from the token endpoint as a missing resource', async () => {
    const { runtime: rt } = runtime(() => textResponse(404, 'Not Found'));
    const error = await rejection(refreshAccessToken(rt, client, 'r'));
    expect(error.kind).toBe('not-found');
    expect(error.message).toContain('the token endpoint');
  });

  it('translates a 502 from the token endpoint as a server error', async () => {
    const { runtime: rt } = runtime(() => textResponse(502, '<html>Bad gateway</html>'));
    const error = await rejection(refreshAccessToken(rt, client, 'r'));
    expect(error.kind).toBe('server');
    expect(error.exitCode).toBe(6);
  });

  it('rejects a success response without an access token', async () => {
    const { runtime: rt } = runtime(() => jsonResponse(200, { token_type: 'bearer' }));
    const error = await rejection(refreshAccessToken(rt, client, 'r'));
    expect(error.kind).toBe('server');
    expect(error.code).toBe('invalid_token_response');
  });

  it('rejects a non-JSON success response', async () => {
    const { runtime: rt } = runtime(() => textResponse(200, '<html>login page</html>'));
    expect((await rejection(refreshAccessToken(rt, client, 'r'))).code).toBe(
      'invalid_token_response',
    );
  });

  it('reports an unreachable token endpoint as a network error', async () => {
    const { runtime: rt } = runtime(() => {
      throw networkFailure('ECONNREFUSED');
    });
    const error = await rejection(refreshAccessToken(rt, client, 'r'));
    expect(error.kind).toBe('network');
    expect(error.exitCode).toBe(7);
    expect(error.message).toContain('auth.example.test');
  });

  it('does not put tokens or the verifier in error output', async () => {
    const { runtime: rt } = runtime(() => jsonResponse(400, { error: 'invalid_grant' }));
    const error = await rejection(
      exchangeAuthorizationCode(rt, client, {
        code: 'secret-code',
        redirectUri: 'r',
        codeVerifier: 'secret-verifier',
      }),
    );
    const rendered = JSON.stringify(error.toJSON());
    expect(rendered).not.toContain('secret-code');
    expect(rendered).not.toContain('secret-verifier');
  });
});

describe('confidential clients', () => {
  const confidential = { ...client, clientSecret: 'client-secret-value' };
  const body = (call: { body: string | undefined } | undefined) =>
    Object.fromEntries(new URLSearchParams(call?.body));

  it('authenticates both grants with the client secret', async () => {
    const { fetch, runtime: rt } = runtime(() =>
      jsonResponse(200, { access_token: 'a', refresh_token: 'r2' }),
    );
    await exchangeAuthorizationCode(rt, confidential, { code: 'c', redirectUri: 'http://x/cb' });
    await refreshAccessToken(rt, confidential, 'r1');

    expect(body(fetch.calls[0])).toEqual({
      grant_type: 'authorization_code',
      code: 'c',
      redirect_uri: 'http://x/cb',
      client_id: 'test-client',
      client_secret: 'client-secret-value',
    });
    expect(body(fetch.calls[1])).toMatchObject({
      grant_type: 'refresh_token',
      refresh_token: 'r1',
      client_secret: 'client-secret-value',
    });
  });

  it('sends the secret only to the token endpoint, never as a header or in the address', async () => {
    const { fetch, runtime: rt } = runtime(() => jsonResponse(200, { access_token: 'a' }));
    await refreshAccessToken(rt, confidential, 'r1');
    const [call] = fetch.calls;
    expect(call?.url.href).toBe(client.tokenEndpoint);
    expect(JSON.stringify([...(call?.headers ?? [])])).not.toContain('client-secret-value');
  });

  it('encodes a JSON token request when the client asks for it', async () => {
    const { fetch, runtime: rt } = runtime(() => jsonResponse(200, { access_token: 'a' }));
    await refreshAccessToken(rt, { ...confidential, tokenRequestFormat: 'json' }, 'r1');
    const [call] = fetch.calls;
    expect(call?.headers.get('content-type')).toBe('application/json');
    expect(JSON.parse(call?.body ?? '')).toEqual({
      grant_type: 'refresh_token',
      refresh_token: 'r1',
      client_id: 'test-client',
      client_secret: 'client-secret-value',
    });
  });

  it('leaves the secret out for a public client', async () => {
    const { fetch, runtime: rt } = runtime(() => jsonResponse(200, { access_token: 'a' }));
    await refreshAccessToken(rt, client, 'r1');
    expect(body(fetch.calls[0])).not.toHaveProperty('client_secret');
  });

  it('does not repeat the secret in an error', async () => {
    const { runtime: rt } = runtime(() =>
      jsonResponse(403, { error: 'invalid_grant', error_description: 'Unknown or invalid.' }),
    );
    const error = await rejection(refreshAccessToken(rt, confidential, 'r1'));
    expect(error.code).toBe('oauth_invalid_grant');
    expect(JSON.stringify(error.toJSON())).not.toContain('client-secret-value');
  });
});
