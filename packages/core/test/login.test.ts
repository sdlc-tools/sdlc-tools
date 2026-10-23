import { request as httpRequest, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { CliError, loginWithPkce, type PkceLoginOptions } from '../src/index.js';
import { FakeAuthorizationServer, TEST_NOW, createTestRuntime } from '../src/testing/index.js';

function setup(options: { signal?: AbortSignal; openUrl?: (url: string) => Promise<void> } = {}) {
  const server = new FakeAuthorizationServer();
  const test = createTestRuntime({
    fetch: server.fetch,
    now: () => TEST_NOW,
    openUrl: options.openUrl ?? server.openUrl,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
  const login = (extra: Partial<PkceLoginOptions> = {}) =>
    loginWithPkce(
      { ...test.runtime, log: (message) => test.runtime.stderr.write(`${message}\n`) },
      { client: server.client, scopes: ['read', 'write'], timeoutMs: 2000, ...extra },
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

async function isListening(address: string): Promise<boolean> {
  try {
    await fetch(address);
    return true;
  } catch {
    return false;
  }
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => {
        resolve(port);
      });
    });
  });
}

function rawRequest(
  url: string,
  options: { method?: string; host?: string },
): Promise<{ status: number }> {
  const target = new URL(url);
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        host: target.hostname,
        port: target.port,
        path: target.pathname + target.search,
        method: options.method ?? 'GET',
        headers: options.host === undefined ? {} : { Host: options.host },
      },
      (response) => {
        response.resume();
        resolve({ status: response.statusCode ?? 0 });
      },
    );
    request.once('error', reject);
    request.end();
  });
}

/** Real loopback sockets are slow work, not in-process logic: budget for a starved machine. */
const REAL_TIMEOUT = 30_000;

describe('loginWithPkce', { timeout: REAL_TIMEOUT }, () => {
  it('completes the authorization code flow with S256 and returns the tokens', async () => {
    const { server, test, login } = setup();
    const tokens = await login();

    expect(tokens).toEqual({
      accessToken: 'access-1',
      tokenType: 'bearer',
      refreshToken: 'refresh-1',
      expiresAt: TEST_NOW + 3_600_000,
      scope: 'read write',
    });

    const [authorization] = server.authorizations;
    expect(authorization).toMatchObject({
      responseType: 'code',
      clientId: 'test-client',
      codeChallengeMethod: 'S256',
      scope: 'read write',
    });
    expect(authorization?.codeChallenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(authorization?.state.length).toBeGreaterThanOrEqual(32);
    expect(authorization?.redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);

    // The fake server only issues tokens when the verifier hashes to the challenge.
    expect(server.tokenRequests[0]).toMatchObject({
      grant_type: 'authorization_code',
      client_id: 'test-client',
      redirect_uri: authorization?.redirectUri,
    });
    expect(test.stderr()).toContain('Open this address in your browser to sign in');
    expect(test.stderr()).toContain(server.client.authorizationEndpoint);
  });

  it('never sends the verifier in the authorization request', async () => {
    const { server, login } = setup();
    await login();
    const verifier = server.tokenRequests[0]?.code_verifier ?? '';
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(JSON.stringify(server.authorizations)).not.toContain(verifier);
  });

  it('stops listening once the sign-in completes', async () => {
    const { server, login } = setup();
    await login();
    const redirect = server.authorizations[0]?.redirectUri ?? '';
    expect(await isListening(redirect)).toBe(false);
  });

  it('answers a callback with the wrong state with 400 and keeps waiting', async () => {
    const { server, test, login } = setup({
      openUrl: async (url) => {
        const forged = await server.approve(url, { state: 'forged' });
        expect(forged.status).toBe(400);
        const genuine = await server.approve(url);
        expect(genuine.status).toBe(200);
      },
    });
    const tokens = await login();
    expect(tokens.accessToken).toBe('access-1');
    expect(test.stderr()).toContain('Ignored a sign-in callback with an unexpected state value.');
    // Only the genuine callback's code was ever exchanged.
    expect(server.tokenRequests).toHaveLength(1);
  });

  it('ignores a callback without a state parameter', async () => {
    const { server, login } = setup({
      openUrl: async (url) => {
        expect((await server.approve(url, { state: null })).status).toBe(400);
        await server.approve(url);
      },
    });
    await login();
    expect(server.tokenRequests).toHaveLength(1);
  });

  it('keeps waiting when the callback carries no code', async () => {
    const { server, login } = setup({
      openUrl: async (url) => {
        expect((await server.approve(url, { code: null })).status).toBe(400);
        await server.approve(url);
      },
    });
    await login();
    expect(server.tokenRequests).toHaveLength(1);
  });

  it('fails with login_denied when the user denies access, without any token request', async () => {
    const { server, login } = setup({
      openUrl: async (url) => {
        await server.approve(url, {
          code: null,
          error: 'access_denied',
          error_description: 'No thanks',
        });
      },
    });
    const error = await rejection(login());
    expect(error.kind).toBe('auth');
    expect(error.exitCode).toBe(3);
    expect(error.code).toBe('login_denied');
    expect(error.message).toContain('No thanks');
    expect(server.tokenRequests).toHaveLength(0);
    expect(await isListening(server.authorizations[0]?.redirectUri ?? '')).toBe(false);
  });

  it('times out when the browser never calls back, and stops listening', async () => {
    let redirect = '';
    const { login } = setup({
      openUrl: (url) => {
        redirect = new URL(url).searchParams.get('redirect_uri') ?? '';
        return Promise.resolve();
      },
    });
    const error = await rejection(login({ timeoutMs: 50 }));
    expect(error.code).toBe('login_timeout');
    expect(error.exitCode).toBe(3);
    expect(await isListening(redirect)).toBe(false);
  });

  it('prints the stall hint while waiting and names it as the cause of a timeout', async () => {
    const { login, test } = setup({ openUrl: () => Promise.resolve() });
    const error = await rejection(login({ timeoutMs: 50, stallHint: 'Check the redirect.' }));
    expect(test.stderr()).toContain('Waiting for the sign-in to finish...\nCheck the redirect.\n');
    expect(error.causes).toEqual(['Check the redirect.']);
  });

  it('can be cancelled while waiting', async () => {
    const controller = new AbortController();
    let redirect = '';
    const { login } = setup({
      signal: controller.signal,
      openUrl: (url) => {
        redirect = new URL(url).searchParams.get('redirect_uri') ?? '';
        setTimeout(() => {
          controller.abort();
        }, 20);
        return Promise.resolve();
      },
    });
    const error = await rejection(login());
    expect(error.kind).toBe('cancelled');
    expect(error.exitCode).toBe(130);
    expect(await isListening(redirect)).toBe(false);
  });

  it('is cancelled immediately when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const { login } = setup({ signal: controller.signal, openUrl: () => Promise.resolve() });
    expect((await rejection(login())).kind).toBe('cancelled');
  });

  it('refuses requests addressed to another host name (DNS rebinding)', async () => {
    let status = 0;
    const { server, login } = setup({
      openUrl: async (url) => {
        const redirect = new URL(url).searchParams.get('redirect_uri') ?? '';
        status = (await rawRequest(redirect, { host: 'attacker.example.test' })).status;
        await server.approve(url);
      },
    });
    await login();
    expect(status).toBe(421);
  });

  it('answers other paths with 404 and other methods with 405', async () => {
    const statuses: number[] = [];
    const { server, login } = setup({
      openUrl: async (url) => {
        const redirect = new URL(url).searchParams.get('redirect_uri') ?? '';
        statuses.push((await rawRequest(new URL('/favicon.ico', redirect).href, {})).status);
        statuses.push((await rawRequest(redirect, { method: 'POST' })).status);
        await server.approve(url);
      },
    });
    await login();
    expect(statuses).toEqual([404, 405]);
  });

  it('listens on a fixed port when asked to', async () => {
    const port = await freePort();
    const { server, login } = setup();
    await login({ port, callbackPath: '/oauth/return' });
    expect(server.authorizations[0]?.redirectUri).toBe(`http://127.0.0.1:${port}/oauth/return`);
  });

  it('reports a busy fixed port', async () => {
    const occupied = createServer();
    await new Promise<void>((resolve) => occupied.listen(0, '127.0.0.1', resolve));
    const { port } = occupied.address() as AddressInfo;
    try {
      const { login } = setup();
      const error = await rejection(login({ port }));
      expect(error.code).toBe('login_port_in_use');
      expect(error.message).toContain(String(port));
    } finally {
      occupied.close();
    }
  });

  it('asks the user to open the address when no browser can be launched', async () => {
    const { server, test, login } = setup({
      openUrl: () => Promise.reject(new Error('no browser')),
    });
    const pending = login();
    // The authorization address is printed first; approve it by hand like a user would.
    await new Promise((resolve) => setTimeout(resolve, 50));
    const url = /https:\/\/auth\.example\.test\S+/.exec(test.stderr())?.[0] ?? '';
    await server.approve(url);
    const tokens = await pending;
    expect(tokens.accessToken).toBe('access-1');
    expect(test.stderr()).toContain('Could not open a browser automatically');
  });

  it('reports a rejected code exchange as an auth error and stops listening', async () => {
    const { server, login } = setup();
    server.failNextTokenRequest(400, { error: 'invalid_grant', error_description: 'code expired' });
    const error = await rejection(login());
    expect(error.kind).toBe('auth');
    expect(error.code).toBe('oauth_invalid_grant');
    expect(error.message).toContain('code expired');
    expect(await isListening(server.authorizations[0]?.redirectUri ?? '')).toBe(false);
  });
});
