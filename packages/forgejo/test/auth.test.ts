import { describe, expect, it } from 'vitest';
import { loadStoredCredential } from '@sdlc-tools/core';
import { TEST_NOW } from '@sdlc-tools/core/testing';
import { HOST } from './support/fake-forgejo.js';
import { Lab } from './support/lab.js';

const TARGET = { tool: 'forgejo', origin: new URL(HOST).origin } as const;

describe('auth login with OAuth', () => {
  it('signs in with PKCE, checks the token against the REST API, and stores tokens and application', async () => {
    const lab = new Lab();
    const run = await lab.run(['auth', 'login', '--client-id', 'test-client']);

    expect(run.code).toBe(0);
    expect(run.stdout).toBe(`Signed in to ${HOST} as alice with OAuth.\n`);
    expect(lab.oauth.authorizations).toHaveLength(1);
    expect(lab.oauth.authorizations[0]).toMatchObject({
      clientId: 'test-client',
      codeChallengeMethod: 'S256',
      responseType: 'code',
    });
    expect(lab.oauth.authorizations[0]?.redirectUri).toMatch(
      /^http:\/\/127\.0\.0\.1:\d+\/callback$/,
    );
    expect(lab.forgejo.log).toEqual(['GET /user']);
    expect(await loadStoredCredential(lab, TARGET)).toMatchObject({
      kind: 'oauth',
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      expiresAt: TEST_NOW + 3600_000,
    });
    expect(lab.store.accounts().toSorted()).toEqual([`forgejo-client:${HOST}`, `forgejo:${HOST}`]);
    expect(run.stdout + run.stderr).not.toContain('access-1');
    expect(run.stdout + run.stderr).not.toContain('refresh-1');
  });

  it('reports the sign-in as JSON', async () => {
    const lab = new Lab();
    const run = await lab.run(['auth', 'login', '--client-id', 'test-client', '--json']);
    expect(run.json()).toEqual({
      host: HOST,
      login: 'alice',
      kind: 'oauth',
      expiresAt: new Date(TEST_NOW + 3600_000).toISOString(),
      renewable: true,
    });
  });

  it('requests scopes only when asked to', async () => {
    const lab = new Lab();
    await lab.run(['auth', 'login', '--client-id', 'test-client']);
    expect(lab.oauth.authorizations[0]?.scope).toBeUndefined();
    await lab.run([
      'auth',
      'login',
      '--client-id',
      'test-client',
      '--scopes',
      'read:user,write:repository',
    ]);
    expect(lab.oauth.authorizations[1]?.scope).toBe('read:user write:repository');
  });

  it('does not keep a sign-in the REST API rejects', async () => {
    const lab = new Lab();
    lab.forgejo.tokens.clear();
    const run = await lab.run(['auth', 'login', '--client-id', 'test-client']);
    expect(run.code).toBe(3);
    expect(lab.store.accounts()).toEqual([]);
  });

  it('fails before any request without an OAuth client id and explains how to get one', async () => {
    const lab = new Lab();
    const run = await lab.run(['auth', 'login']);
    expect(run.code).toBe(2);
    expect(run.stderr).toContain('Missing OAuth client id.');
    expect(run.stderr).toContain('--client-id');
    expect(run.stderr).toContain('SDLC_FORGEJO_CLIENT_ID');
    expect(run.stderr).toContain('--with-token');
    expect(lab.fetch.calls).toHaveLength(0);
  });

  it('rejects a callback port that is not a port number before any request', async () => {
    const lab = new Lab();
    const run = await lab.run(['auth', 'login', '--client-id', 'x', '--callback-port', '70000']);
    expect(run.code).toBe(2);
    expect(run.stderr).toContain('not a valid port number');
    expect(lab.fetch.calls).toHaveLength(0);
  });

  it('explains an Unregistered Redirect URI page while waiting for the browser', async () => {
    const lab = new Lab();
    const controller = new AbortController();
    const run = await lab.run(['auth', 'login', '--client-id', 'test-client'], {
      openUrl: () => {
        controller.abort();
        return Promise.resolve();
      },
      signal: controller.signal,
    });
    expect(run.stderr).toContain('Waiting for the sign-in to finish...');
    expect(run.stderr).toContain('"Unregistered Redirect URI"');
    expect(run.stderr).toContain('confidential client');
    expect(run.stderr).toContain('public client');
    expect(run.stderr).toContain('http://127.0.0.1:<port>/callback');
    expect(run.stderr).toContain('--callback-port <port>` with that same port');
  });

  it('takes the client id from the environment', async () => {
    const lab = new Lab();
    const run = await lab.run(['auth', 'login'], {
      env: { SDLC_FORGEJO_CLIENT_ID: 'test-client' },
    });
    expect(run.code).toBe(0);
  });
});

describe('renewing an OAuth sign-in', () => {
  it('renews shortly before expiry using the application recorded at sign-in, and stores the rotated tokens', async () => {
    const lab = new Lab();
    await lab.signInWithOAuth();
    lab.now = TEST_NOW + 3600_000 - 30_000;

    const run = await lab.run(['pr', 'list', '--repo', 'acme/widgets']);

    expect(run.code).toBe(0);
    expect(lab.oauth.tokenRequests.at(-1)).toMatchObject({
      grant_type: 'refresh_token',
      refresh_token: 'refresh-1',
      client_id: 'test-client',
    });
    expect(lab.fetch.calls.at(-1)?.headers.get('authorization')).toBe('Bearer access-2');
    expect(await loadStoredCredential(lab, TARGET)).toMatchObject({
      accessToken: 'access-2',
      refreshToken: 'refresh-2',
    });
  });

  it('renews once and retries when the server answers 401 to a token that still looks fresh', async () => {
    const lab = new Lab();
    await lab.signInWithOAuth();
    lab.forgejo.tokens.delete('access-1');

    const run = await lab.run(['pr', 'list', '--repo', 'acme/widgets']);

    expect(run.code).toBe(0);
    const sent = lab.fetch.calls.filter((call) => call.url.pathname.endsWith('/pulls'));
    expect(sent.map((call) => call.headers.get('authorization'))).toEqual([
      'Bearer access-1',
      'Bearer access-2',
    ]);
    expect(
      lab.oauth.tokenRequests.filter((form) => form.grant_type === 'refresh_token'),
    ).toHaveLength(1);
  });

  it('tells the user to sign in again when the refresh token is no longer valid', async () => {
    const lab = new Lab();
    await lab.signInWithOAuth();
    lab.oauth.revokeRefreshTokens();
    lab.now = TEST_NOW + 3600_000;

    const run = await lab.run(['pr', 'list', '--repo', 'acme/widgets']);

    expect(run.code).toBe(3);
    expect(run.stderr).toContain('Sign in again with `sdlc-forgejo auth login`.');
    expect(lab.forgejo.log.filter((entry) => entry.startsWith('GET /repos'))).toHaveLength(0);
  });
});

describe('auth login with a personal access token', () => {
  it('reads the token from standard input, verifies it, and stores it', async () => {
    const lab = new Lab();
    lab.stdin = 'pat-1\n';
    const run = await lab.run(['auth', 'login', '--with-token']);

    expect(run.code).toBe(0);
    expect(run.stdout).toBe(`Signed in to ${HOST} as alice with an access token.\n`);
    expect(await loadStoredCredential(lab, TARGET)).toEqual({ kind: 'token', token: 'pat-1' });
    expect(lab.store.accounts()).toEqual([`forgejo:${HOST}`]);
    expect(run.stdout + run.stderr).not.toContain('pat-1\n');

    const list = await lab.run(['pr', 'list', '--repo', 'acme/widgets']);
    expect(list.code).toBe(0);
    expect(lab.fetch.calls.at(-1)?.headers.get('authorization')).toBe('Bearer pat-1');
  });

  it('does not store a token the server rejects', async () => {
    const lab = new Lab();
    lab.stdin = 'not-a-token';
    const run = await lab.run(['auth', 'login', '--with-token']);
    expect(run.code).toBe(3);
    expect(lab.store.accounts()).toEqual([]);
  });

  it.each([
    ['', 'empty'],
    ['two words', 'two words'],
    ['a\nb', 'two lines'],
  ])(
    'refuses standard input that is not exactly one token (%j: %s) without any request',
    async (stdin) => {
      const lab = new Lab();
      lab.stdin = stdin;
      const run = await lab.run(['auth', 'login', '--with-token']);
      expect(run.code).toBe(2);
      expect(run.stderr).toContain('did not hold a single access token');
      expect(lab.fetch.calls).toHaveLength(0);
    },
  );
});

describe('credentials', () => {
  it('uses SDLC_FORGEJO_TOKEN without storing it', async () => {
    const lab = new Lab();
    const run = await lab.run(['pr', 'list', '--repo', 'acme/widgets'], {
      env: { SDLC_FORGEJO_TOKEN: 'pat-1' },
    });
    expect(run.code).toBe(0);
    expect(lab.store.accounts()).toEqual([]);
  });

  it('fails with exit code 3 before any request when there is no credential', async () => {
    const lab = new Lab();
    const run = await lab.run(['pr', 'list', '--repo', 'acme/widgets']);
    expect(run.code).toBe(3);
    expect(run.stderr).toContain(`No credentials found for ${HOST}.`);
    expect(run.stderr).toContain('sdlc-forgejo auth login');
    expect(run.stderr).toContain('SDLC_FORGEJO_TOKEN');
    expect(lab.fetch.calls).toHaveLength(0);
  });

  it('never offers a credential to another server', async () => {
    const lab = new Lab();
    await lab.signInWithToken();
    const run = await lab.run([
      'pr',
      'list',
      '--repo',
      'acme/widgets',
      '--host',
      'https://other.example.test',
    ]);
    expect(run.code).toBe(3);
    expect(lab.fetch.calls).toHaveLength(0);
  });

  it('keeps accounts on one server apart with profiles', async () => {
    const lab = new Lab();
    await lab.signInWithToken();
    const run = await lab.run(['pr', 'list', '--repo', 'acme/widgets', '--profile', 'work']);
    expect(run.code).toBe(3);
    expect(lab.fetch.calls).toHaveLength(0);
  });

  it('refuses a project file that chooses the server', async () => {
    const lab = new Lab();
    const run = await lab.run(['pr', 'list', '--repo', 'acme/widgets'], {
      env: { SDLC_FORGEJO_HOST: undefined },
    });
    expect(run.code).toBe(2);
    expect(run.stderr).toContain('Missing Forgejo server address.');
    expect(lab.fetch.calls).toHaveLength(0);
  });
});

describe('auth status and logout', () => {
  it('asks the server who the stored credentials belong to', async () => {
    const lab = new Lab();
    await lab.signInWithToken();
    const run = await lab.run(['auth', 'status']);
    expect(run.code).toBe(0);
    expect(run.stdout).toBe(`Signed in to ${HOST} as alice (token, from the keychain).\n`);
    expect((await lab.run(['auth', 'status', '--json'])).json()).toEqual({
      host: HOST,
      profile: 'default',
      login: 'alice',
      kind: 'token',
      source: 'keychain',
      expiresAt: null,
    });
  });

  it('names the environment variable as the source of a token from it', async () => {
    const lab = new Lab();
    const run = await lab.run(['auth', 'status'], { env: { SDLC_FORGEJO_TOKEN: 'pat-1' } });
    expect(run.stdout).toContain('SDLC_FORGEJO_TOKEN variable');
  });

  it('shows the renewed expiry of an OAuth sign-in', async () => {
    const lab = new Lab();
    await lab.signInWithOAuth();
    lab.now = TEST_NOW + 3600_000 - 30_000;
    const run = await lab.run(['auth', 'status', '--json']);
    expect(run.json()).toMatchObject({
      kind: 'oauth',
      expiresAt: new Date(lab.now + 3600_000).toISOString(),
    });
  });

  it('exits with 3 when not signed in', async () => {
    const lab = new Lab();
    expect((await lab.run(['auth', 'status'])).code).toBe(3);
    expect(lab.fetch.calls).toHaveLength(0);
  });

  it('removes the credential and the application record, and says so when there is nothing to remove', async () => {
    const lab = new Lab();
    await lab.signInWithOAuth();
    const first = await lab.run(['auth', 'logout']);
    expect(first.stdout).toBe(`Signed out of ${HOST}.\n`);
    expect(lab.store.accounts()).toEqual([]);
    const second = await lab.run(['auth', 'logout']);
    expect(second.code).toBe(0);
    expect(second.stdout).toBe(`No stored credentials for ${HOST}.\n`);
  });
});
