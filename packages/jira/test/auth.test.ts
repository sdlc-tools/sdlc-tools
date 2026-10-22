import { loadStoredCredential } from '@sdlc-tools/core';
import { MemorySecretStore, jsonResponse, mockFetch } from '@sdlc-tools/core/testing';
import { describe, expect, it } from 'vitest';
import { BASIC, EMAIL, SITE, TOKEN, fakeJira, jira } from './helpers.js';

const ME = { accountId: '5b10a2844c20165700ede21f', displayName: 'Ada Lovelace' };
const LOGIN_ENV = { SDLC_JIRA_TOKEN: TOKEN };

describe('auth login', () => {
  it('verifies the token, then stores it with the e-mail in the keychain', async () => {
    const fetch = fakeJira({ 'GET /rest/api/3/myself': ME });
    const store = new MemorySecretStore();
    const run = await jira(['auth', 'login', '--site', SITE, '--email', EMAIL], {
      env: LOGIN_ENV,
      fetch,
      store,
    });

    expect(run.code).toBe(0);
    expect(run.stdout).toContain(`Signed in to team.example.test as Ada Lovelace (${EMAIL})`);
    expect(fetch.calls).toHaveLength(1);
    expect(fetch.calls[0]?.headers.get('authorization')).toBe(BASIC);

    const stored = await loadStoredCredential({ store }, { tool: 'jira', origin: SITE });
    expect(stored).toEqual({ kind: 'token', token: TOKEN, username: EMAIL });
  });

  it('never prints the token, and --json carries no secret', async () => {
    const run = await jira(['auth', 'login', '--site', SITE, '--email', EMAIL, '--json'], {
      env: LOGIN_ENV,
      fetch: fakeJira({ 'GET /rest/api/3/myself': ME }),
    });
    expect(run.stdout + run.stderr).not.toContain(TOKEN);
    expect(run.json()).toEqual({
      site: SITE,
      profile: 'default',
      accountId: ME.accountId,
      displayName: ME.displayName,
      email: EMAIL,
      storage: 'keychain',
    });
  });

  it('stores nothing when the site rejects the token', async () => {
    const store = new MemorySecretStore();
    const run = await jira(['auth', 'login', '--site', SITE, '--email', EMAIL], {
      env: LOGIN_ENV,
      fetch: mockFetch(() => jsonResponse(401, { message: 'Unauthorized' })),
      store,
    });
    expect(run.code).toBe(3);
    expect(run.stderr).toContain('401');
    expect(await loadStoredCredential({ store }, { tool: 'jira', origin: SITE })).toBeUndefined();
  });

  it('keeps one credential per profile', async () => {
    const store = new MemorySecretStore();
    const fetch = fakeJira({ 'GET /rest/api/3/myself': ME });
    await jira(['auth', 'login', '--site', SITE, '--email', EMAIL, '--profile', 'ops'], {
      env: LOGIN_ENV,
      fetch,
      store,
    });
    expect(
      await loadStoredCredential({ store }, { tool: 'jira', origin: SITE, profile: 'ops' }),
    ).toBeDefined();
    expect(await loadStoredCredential({ store }, { tool: 'jira', origin: SITE })).toBeUndefined();
  });

  it.each([
    ['no token', { SDLC_JIRA_SITE: SITE }, ['auth', 'login', '--email', EMAIL], 'SDLC_JIRA_TOKEN'],
    ['no e-mail', LOGIN_ENV, ['auth', 'login', '--site', SITE], '--email'],
    ['no site', LOGIN_ENV, ['auth', 'login', '--email', EMAIL], '--site'],
    [
      'a malformed e-mail',
      LOGIN_ENV,
      ['auth', 'login', '--site', SITE, '--email', 'nobody'],
      '--email',
    ],
    [
      'an insecure site',
      LOGIN_ENV,
      ['auth', 'login', '--site', 'http://team.example.test', '--email', EMAIL],
      'https',
    ],
  ])('fails before any request with %s', async (_name, env, argv, expected) => {
    const run = await jira(argv, { env });
    expect(run.code).toBe(2);
    expect(run.stderr).toContain(expected);
    expect(run.fetchCalls).toHaveLength(0);
    expect(run.stdout).toBe('');
  });
});

describe('auth status', () => {
  it('names the account and where the credentials came from', async () => {
    const run = await jira(['auth', 'status'], {
      fetch: fakeJira({ 'GET /rest/api/3/myself': ME }),
    });
    expect(run.code).toBe(0);
    expect(run.stdout).toContain('Ada Lovelace');
    expect(run.stdout).toContain('environment');
  });

  it('uses the keychain credential, and reports a missing one with exit code 3', async () => {
    const store = new MemorySecretStore();
    const login = await jira(['auth', 'login', '--site', SITE, '--email', EMAIL], {
      env: LOGIN_ENV,
      fetch: fakeJira({ 'GET /rest/api/3/myself': ME }),
      store,
    });
    expect(login.code).toBe(0);

    const fetch = fakeJira({ 'GET /rest/api/3/myself': ME });
    const ok = await jira(['auth', 'status'], { env: { SDLC_JIRA_SITE: SITE }, fetch, store });
    expect(ok.stdout).toContain('keychain');
    expect(fetch.calls[0]?.headers.get('authorization')).toBe(BASIC);

    const missing = await jira(['auth', 'status'], { env: { SDLC_JIRA_SITE: SITE } });
    expect(missing.code).toBe(3);
    expect(missing.stderr).toContain('sdlc-jira auth login');
    expect(missing.fetchCalls).toHaveLength(0);
  });

  it('asks for the e-mail when only a token is in the environment', async () => {
    const run = await jira(['auth', 'status'], {
      env: { SDLC_JIRA_SITE: SITE, SDLC_JIRA_TOKEN: TOKEN },
    });
    expect(run.code).toBe(3);
    expect(run.stderr).toContain('SDLC_JIRA_EMAIL');
    expect(run.fetchCalls).toHaveLength(0);
  });
});

describe('auth logout', () => {
  it('removes the stored credential and says so when there is none', async () => {
    const store = new MemorySecretStore();
    await jira(['auth', 'login', '--site', SITE, '--email', EMAIL], {
      env: LOGIN_ENV,
      fetch: fakeJira({ 'GET /rest/api/3/myself': ME }),
      store,
    });
    const first = await jira(['auth', 'logout', '--json'], {
      env: { SDLC_JIRA_SITE: SITE },
      store,
    });
    expect(first.json()).toMatchObject({ removed: true });
    const second = await jira(['auth', 'logout'], { env: { SDLC_JIRA_SITE: SITE }, store });
    expect(second.code).toBe(0);
    expect(second.stdout).toContain('No stored credentials');
  });
});
