import { describe, expect, it } from 'vitest';
import { CliError, loginWithPkce, type PkceLoginOptions } from '../src/index.js';
import {
  FakeAuthorizationServer,
  TEST_NOW,
  createTestRuntime,
  type FakeAuthorizationServerOptions,
} from '../src/testing/index.js';

const SECRET = 'client-secret-value';

function setup(serverOptions: FakeAuthorizationServerOptions = { clientSecret: SECRET }) {
  const server = new FakeAuthorizationServer(serverOptions);
  const test = createTestRuntime({
    fetch: server.fetch,
    now: () => TEST_NOW,
    openUrl: server.openUrl,
  });
  const login = (extra: Partial<PkceLoginOptions> = {}) =>
    loginWithPkce(
      { ...test.runtime, log: (message) => test.runtime.stderr.write(`${message}\n`) },
      { client: server.client, timeoutMs: 2000, ...extra },
    );
  return { server, test, login };
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

/** Real loopback sockets are slow work, not in-process logic: budget for a starved machine. */
const REAL_TIMEOUT = 30_000;

describe('loginWithPkce as a confidential client', { timeout: REAL_TIMEOUT }, () => {
  it('authenticates with the client secret and sends no PKCE parameters when pkce is off', async () => {
    const { server, login } = setup();
    const tokens = await login({ pkce: false, scopes: ['read'] });

    expect(tokens.accessToken).toBe('access-1');
    const [authorization] = server.authorizations;
    expect(authorization?.parameters).not.toHaveProperty('code_challenge');
    expect(authorization?.parameters).not.toHaveProperty('code_challenge_method');
    expect(authorization).toMatchObject({ responseType: 'code', scope: 'read' });

    const [request] = server.tokenRequests;
    expect(request).toMatchObject({
      grant_type: 'authorization_code',
      client_id: 'test-client',
      client_secret: SECRET,
      redirect_uri: authorization?.redirectUri,
    });
    expect(request).not.toHaveProperty('code_verifier');
  });

  it('never puts the client secret in the authorization address or the terminal output', async () => {
    const { server, test, login } = setup();
    await login({ pkce: false });
    expect(JSON.stringify(server.authorizations)).not.toContain(SECRET);
    expect(test.stderr()).not.toContain(SECRET);
  });

  it('keeps PKCE on by default, next to the client secret', async () => {
    const { server, login } = setup();
    await login();

    expect(server.authorizations[0]?.codeChallengeMethod).toBe('S256');
    expect(server.tokenRequests[0]).toMatchObject({ client_secret: SECRET });
    expect(server.tokenRequests[0]?.code_verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('sends the extra authorization parameters the server requires', async () => {
    const { server, login } = setup();
    await login({ pkce: false, extraParams: { audience: 'api.example.test', prompt: 'consent' } });
    expect(server.authorizations[0]?.parameters).toMatchObject({
      audience: 'api.example.test',
      prompt: 'consent',
    });
  });

  it('encodes the token request as JSON when the server documents a JSON body', async () => {
    const { server, login } = setup({ clientSecret: SECRET, tokenRequestFormat: 'json' });
    await login({ pkce: false });

    expect(server.fetch.calls[0]?.headers.get('content-type')).toBe('application/json');
    expect(server.tokenRequests[0]).toMatchObject({
      grant_type: 'authorization_code',
      client_secret: SECRET,
    });
  });

  it('refuses the old secret once the secret was changed on the server', async () => {
    const { server, login } = setup();
    server.changeClientSecret('regenerated-secret');
    const error = await rejection(login({ pkce: false }));
    expect(error.code).toBe('oauth_invalid_client');

    const tokens = await login({
      pkce: false,
      client: { ...server.client, clientSecret: 'regenerated-secret' },
    });
    expect(tokens.accessToken).toBe('access-1');
  });

  it('fails with invalid_client for a wrong secret and repeats neither secret', async () => {
    const { server, login } = setup();
    const wrong = { ...server.client, clientSecret: 'a-different-secret' };
    const error = await rejection(login({ pkce: false, client: wrong }));

    expect(error.kind).toBe('auth');
    expect(error.code).toBe('oauth_invalid_client');
    const printed = JSON.stringify(error.toJSON()) + error.message;
    expect(printed).not.toContain(SECRET);
    expect(printed).not.toContain('a-different-secret');
  });
});
