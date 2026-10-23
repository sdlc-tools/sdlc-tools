import { describe, expect, it } from 'vitest';
import {
  CliError,
  HttpClient,
  OAuthSession,
  loadStoredCredential,
  saveCredential,
  type OAuthCredential,
} from '../src/index.js';
import {
  FakeAuthorizationServer,
  MemorySecretStore,
  TEST_NOW,
  jsonResponse,
  mockFetch,
  networkFailure,
} from '../src/testing/index.js';

const TARGET = { tool: 'forgejo', origin: 'https://git.example.test' } as const;

async function rejection(promise: Promise<unknown>): Promise<CliError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(CliError);
    return error as CliError;
  }
  throw new Error('expected a rejection');
}

/** Signs in against a fake server, then returns a session over the stored credential. */
async function signedIn(options: { now?: () => number; expiresInSeconds?: number } = {}) {
  const server = new FakeAuthorizationServer({
    expiresInSeconds: options.expiresInSeconds ?? 3600,
  });
  const store = new MemorySecretStore();
  const { loginWithPkce } = await import('../src/index.js');
  const clock = { now: TEST_NOW };
  const now = options.now ?? (() => clock.now);
  const tokens = await loginWithPkce(
    {
      fetch: server.fetch.fetch,
      now,
      signal: undefined,
      openUrl: server.openUrl,
      log: () => undefined,
    },
    { client: server.client, timeoutMs: 2000 },
  );
  const credential: OAuthCredential = { kind: 'oauth', ...tokens };
  await saveCredential({ store }, TARGET, credential);
  const session = new OAuthSession({
    runtime: { fetch: server.fetch.fetch, now, signal: undefined, store },
    target: TARGET,
    client: server.client,
    credential,
    loginCommand: 'sdlc-forgejo auth login',
  });
  return { server, store, session, clock, credential };
}

describe('OAuthSession', () => {
  it('sends the stored access token without contacting the server while it is fresh', async () => {
    const { server, session } = await signedIn();
    const before = server.fetch.calls.length;
    expect(await session.authorization()).toBe('Bearer access-1');
    expect(server.fetch.calls).toHaveLength(before);
  });

  it('renews shortly before expiry and stores the rotated tokens', async () => {
    const { server, store, session, clock } = await signedIn({ expiresInSeconds: 3600 });
    clock.now = TEST_NOW + 3600_000 - 30_000;

    expect(await session.authorization()).toBe('Bearer access-2');
    expect(server.tokenRequests.at(-1)).toMatchObject({
      grant_type: 'refresh_token',
      refresh_token: 'refresh-1',
    });
    const stored = await loadStoredCredential({ store }, TARGET);
    expect(stored).toMatchObject({
      kind: 'oauth',
      accessToken: 'access-2',
      refreshToken: 'refresh-2',
    });
  });

  it('renews only once for concurrent callers', async () => {
    const { server, session, clock } = await signedIn();
    clock.now = TEST_NOW + 3600_000;
    const refreshesBefore = server.tokenRequests.length;

    const headers = await Promise.all([
      session.authorization(),
      session.authorization(),
      session.refresh(),
    ]);
    expect(headers.slice(0, 2)).toEqual(['Bearer access-2', 'Bearer access-2']);
    expect(server.tokenRequests.length - refreshesBefore).toBe(1);
  });

  it('refreshes on demand after a 401 and reports whether it could', async () => {
    const { session, store } = await signedIn();
    expect(await session.refresh()).toBe(true);
    expect(await session.authorization()).toBe('Bearer access-2');
    expect(await loadStoredCredential({ store }, TARGET)).toMatchObject({
      accessToken: 'access-2',
    });

    const withoutRefresh = new OAuthSession({
      runtime: { fetch: fetch, now: () => TEST_NOW, signal: undefined, store },
      target: TARGET,
      client: { clientId: 'x', tokenEndpoint: 'https://auth.example.test/t' },
      credential: { kind: 'oauth', accessToken: 'a', tokenType: 'bearer' },
    });
    expect(await withoutRefresh.refresh()).toBe(false);
  });

  it('fails locally when the token expired and cannot be renewed', async () => {
    const server = new FakeAuthorizationServer();
    const session = new OAuthSession({
      runtime: {
        fetch: server.fetch.fetch,
        now: () => TEST_NOW,
        signal: undefined,
        store: new MemorySecretStore(),
      },
      target: TARGET,
      client: server.client,
      credential: { kind: 'oauth', accessToken: 'a', tokenType: 'bearer', expiresAt: TEST_NOW - 1 },
      loginCommand: 'sdlc-forgejo auth login',
    });
    const error = await rejection(session.authorization());
    expect(error.kind).toBe('auth');
    expect(error.code).toBe('token_expired');
    expect(error.next).toEqual(['Sign in again with `sdlc-forgejo auth login`.']);
    expect(server.fetch.calls).toHaveLength(0);
  });

  it('fails with refresh_failed when the refresh token is no longer valid', async () => {
    const { server, session, clock } = await signedIn();
    server.revokeRefreshTokens();
    clock.now = TEST_NOW + 3600_000;
    const error = await rejection(session.authorization());
    expect(error.kind).toBe('auth');
    expect(error.exitCode).toBe(3);
    expect(error.code).toBe('refresh_failed');
    expect(error.next).toEqual(['Sign in again with `sdlc-forgejo auth login`.']);
  });

  it('adopts credentials another process already rotated', async () => {
    const { server, session, store, clock } = await signedIn();
    // Another process refreshed first: the store holds newer tokens, and our refresh token is spent.
    server.revokeRefreshTokens();
    await saveCredential({ store }, TARGET, {
      kind: 'oauth',
      accessToken: 'from-other-process',
      tokenType: 'bearer',
      refreshToken: 'rotated-elsewhere',
      expiresAt: TEST_NOW + 7200_000,
    });
    clock.now = TEST_NOW + 3600_000;
    expect(await session.authorization()).toBe('Bearer from-other-process');
  });

  it('propagates network failures during renewal and keeps the stored credential', async () => {
    const { store, clock } = await signedIn();
    const failing = mockFetch(() => {
      throw networkFailure('ETIMEDOUT');
    });
    const stored = await loadStoredCredential({ store }, TARGET);
    const session = new OAuthSession({
      runtime: { fetch: failing.fetch, now: () => clock.now, signal: undefined, store },
      target: TARGET,
      client: { clientId: 'test-client', tokenEndpoint: 'https://auth.example.test/t' },
      credential: { ...(stored as OAuthCredential), expiresAt: TEST_NOW },
    });
    const error = await rejection(session.authorization());
    expect(error.kind).toBe('network');
    expect(await loadStoredCredential({ store }, TARGET)).toEqual(stored);
  });

  it('keeps the previous scope when a refresh response omits it', async () => {
    const { session, store } = await signedIn();
    await session.refresh();
    const stored = await loadStoredCredential({ store }, TARGET);
    expect(stored).toMatchObject({ kind: 'oauth', refreshToken: 'refresh-2' });
  });

  it('works end to end with the HTTP client: renews before a request and once after a 401', async () => {
    const { server, session, clock } = await signedIn();
    const api = mockFetch([
      () => jsonResponse(200, { who: 'me' }),
      () => jsonResponse(401, { message: 'token revoked' }),
      () => jsonResponse(200, { who: 'me-again' }),
    ]);
    const http = new HttpClient({
      baseUrl: 'https://git.example.test/api/v1',
      fetch: api.fetch,
      auth: session,
    });

    clock.now = TEST_NOW + 3600_000;
    expect((await http.get('/user')).data).toEqual({ who: 'me' });
    expect(api.calls[0]?.headers.get('authorization')).toBe('Bearer access-2');

    expect((await http.get('/user')).data).toEqual({ who: 'me-again' });
    expect(api.calls[1]?.headers.get('authorization')).toBe('Bearer access-2');
    expect(api.calls[2]?.headers.get('authorization')).toBe('Bearer access-3');
    expect(
      server.tokenRequests.filter((request) => request.grant_type === 'refresh_token'),
    ).toHaveLength(2);
  });
});

describe('OAuthSession for a confidential client', () => {
  it('renews with the client secret in the encoding the server documents', async () => {
    const server = new FakeAuthorizationServer({
      clientSecret: 'client-secret-value',
      tokenRequestFormat: 'json',
    });
    const store = new MemorySecretStore();
    const credential: OAuthCredential = {
      kind: 'oauth',
      accessToken: 'stale',
      tokenType: 'bearer',
      refreshToken: 'refresh-0',
      expiresAt: TEST_NOW,
    };
    // Seed a refresh token the server knows by signing in once.
    const { loginWithPkce } = await import('../src/index.js');
    const tokens = await loginWithPkce(
      {
        fetch: server.fetch.fetch,
        now: () => TEST_NOW,
        signal: undefined,
        openUrl: server.openUrl,
        log: () => undefined,
      },
      { client: server.client, pkce: false, timeoutMs: 2000 },
    );
    const session = new OAuthSession({
      runtime: { fetch: server.fetch.fetch, now: () => TEST_NOW, signal: undefined, store },
      target: TARGET,
      client: server.client,
      credential: { ...credential, refreshToken: tokens.refreshToken },
    });

    expect(await session.authorization()).toBe('Bearer access-2');
    expect(server.tokenRequests.at(-1)).toMatchObject({
      grant_type: 'refresh_token',
      client_secret: 'client-secret-value',
    });
    expect(server.fetch.calls.at(-1)?.headers.get('content-type')).toBe('application/json');
    expect(await loadStoredCredential({ store }, TARGET)).toMatchObject({
      accessToken: 'access-2',
      refreshToken: 'refresh-2',
    });
  });
});
