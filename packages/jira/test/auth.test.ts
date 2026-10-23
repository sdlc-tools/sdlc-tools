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

describe('auth login token input', () => {
  const FLAGS = ['auth', 'login', '--site', SITE, '--email', EMAIL] as const;
  const SIGNED_IN = { 'GET /rest/api/3/myself': ME };

  /** Nothing the run printed or stored may contain the token. */
  function expectNoLeak(run: { stdout: string; stderr: string }, secret = TOKEN) {
    expect(run.stdout + run.stderr).not.toContain(secret);
  }

  it('signs in with a token piped to --with-token', async () => {
    const fetch = fakeJira(SIGNED_IN);
    const store = new MemorySecretStore();
    const run = await jira([...FLAGS, '--with-token'], {
      env: {},
      stdin: `${TOKEN}\n`,
      fetch,
      store,
    });

    expect(run.code).toBe(0);
    expect(fetch.calls[0]?.headers.get('authorization')).toBe(BASIC);
    expect(await loadStoredCredential({ store }, { tool: 'jira', origin: SITE })).toEqual({
      kind: 'token',
      token: TOKEN,
      username: EMAIL,
    });
    expectNoLeak(run);
  });

  it('signs in with a token typed at a prompt that shows nothing', async () => {
    const fetch = fakeJira(SIGNED_IN);
    const run = await jira(FLAGS, { env: {}, stdin: { typed: TOKEN }, fetch });

    expect(run.code).toBe(0);
    expect(fetch.calls[0]?.headers.get('authorization')).toBe(BASIC);
    expect(run.stderr).toBe('API token: \n');
    expectNoLeak(run);
  });

  it('prompts for --with-token too when standard input is a terminal', async () => {
    const run = await jira([...FLAGS, '--with-token'], {
      env: {},
      stdin: { typed: TOKEN },
      fetch: fakeJira(SIGNED_IN),
    });
    expect(run.code).toBe(0);
    expect(run.stderr).toBe('API token: \n');
  });

  it('prefers the environment variable to the prompt, and the flag to the variable', async () => {
    const fromVariable = await jira(FLAGS, {
      env: { SDLC_JIRA_TOKEN: TOKEN },
      stdin: { typed: 'typed-token' },
      fetch: fakeJira(SIGNED_IN),
    });
    expect(fromVariable.code).toBe(0);
    expect(fromVariable.fetchCalls[0]?.headers.get('authorization')).toBe(BASIC);
    expect(fromVariable.stderr).toBe('');

    const fromFlag = await jira([...FLAGS, '--with-token'], {
      env: { SDLC_JIRA_TOKEN: 'variable-token' },
      stdin: TOKEN,
      fetch: fakeJira(SIGNED_IN),
    });
    expect(fromFlag.fetchCalls[0]?.headers.get('authorization')).toBe(BASIC);
  });

  it('reports the sign-in as JSON without the token', async () => {
    const run = await jira([...FLAGS, '--with-token', '--json'], {
      env: {},
      stdin: TOKEN,
      fetch: fakeJira(SIGNED_IN),
    });
    expect(run.json()).toMatchObject({ email: EMAIL, storage: 'keychain' });
    expectNoLeak(run);
  });

  it('does not read standard input unless asked, and lists every way to give the token', async () => {
    const run = await jira(FLAGS, { env: {}, stdin: TOKEN });
    expect(run.code).toBe(2);
    expect(run.stderr).toContain('SDLC_JIRA_TOKEN is not set and standard input is not a terminal');
    expect(run.stderr).toContain('--with-token');
    expect(run.fetchCalls).toHaveLength(0);
  });

  it.each([
    ['empty piped input', ['--with-token'], '', 'Standard input was empty'],
    ['blank piped input', ['--with-token'], '\n  \n', 'Standard input was empty'],
    ['nothing typed', [], { typed: '' }, 'Nothing was typed'],
  ] as const)('fails before any request on %s', async (_name, extra, stdin, message) => {
    const store = new MemorySecretStore();
    const run = await jira([...FLAGS, ...extra], { env: {}, stdin, store });

    expect(run.code).toBe(2);
    expect(run.stderr).toContain(`${message}: the API token is missing.`);
    expect(run.fetchCalls).toHaveLength(0);
    expect(run.stdout).toBe('');
    expect(await loadStoredCredential({ store }, { tool: 'jira', origin: SITE })).toBeUndefined();
  });

  it.each([
    ['two words', 'two words'],
    ['two lines', 'first-line\nsecond-line\n'],
  ])('refuses piped input with %s and does not repeat it, even as JSON', async (_name, stdin) => {
    const run = await jira([...FLAGS, '--with-token', '--json'], { env: {}, stdin });

    expect(run.code).toBe(2);
    expect(run.errorJson().error).toMatchObject({ kind: 'usage', code: 'invalid_secret' });
    expect(run.stdout + run.stderr).not.toMatch(/two|first-line|second-line/);
    expect(run.fetchCalls).toHaveLength(0);
  });

  it('does not echo a token the site rejects, and stores nothing', async () => {
    const store = new MemorySecretStore();
    const run = await jira([...FLAGS, '--with-token', '--json'], {
      env: {},
      stdin: TOKEN,
      fetch: mockFetch(() => jsonResponse(401, { message: 'Unauthorized' })),
      store,
    });

    expect(run.code).toBe(3);
    expectNoLeak(run);
    expect(await loadStoredCredential({ store }, { tool: 'jira', origin: SITE })).toBeUndefined();
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

  it('shows that an API token is in use and that it has no expiry', async () => {
    const run = await jira(['auth', 'status', '--json'], {
      fetch: fakeJira({ 'GET /rest/api/3/myself': ME }),
    });
    expect(run.json()).toMatchObject({ kind: 'token', email: EMAIL, expiresAt: null });
    const text = await jira(['auth', 'status'], {
      fetch: fakeJira({ 'GET /rest/api/3/myself': ME }),
    });
    expect(text.stdout).toContain(`as Ada Lovelace (${EMAIL}) with an API token`);
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
