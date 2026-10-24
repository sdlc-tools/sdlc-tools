import { loadStoredCredential, saveCredential } from '@sdlc-tools/core';
import { TEST_NOW } from '@sdlc-tools/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AtlassianLab,
  CLIENT_ID,
  CLIENT_SECRET,
  CLOUD_ID,
  GATEWAY_PATH,
  ME,
  USER_CONFIG,
  errorOf,
  expectNoSecrets,
} from './atlassian-lab.js';
import { EMAIL, ENV, ISSUE, SITE, fakeJira, jira } from './helpers.js';

const TARGET = { tool: 'jira', origin: SITE } as const;
const CREDENTIAL_ACCOUNT = `jira:${SITE}`;
const APP_ACCOUNT = `jira-oauth:${SITE}`;
const HOUR = 3_600_000;

let lab: AtlassianLab;
beforeEach(async () => {
  lab = await AtlassianLab.create();
});

describe('auth login --oauth', () => {
  it('signs in through the browser, finds the cloud id and checks the gateway', async () => {
    const run = await lab.login();

    expect(run.code, run.stderr).toBe(0);
    expect(run.stdout).toContain(
      'Signed in to team.example.test as Ada Lovelace with OAuth. The tokens and the client secret are stored in the keychain.',
    );

    // The authorization request is the one Atlassian documents, with no PKCE.
    const [authorization] = lab.auth.authorizations;
    expect(authorization?.parameters).toEqual({
      response_type: 'code',
      client_id: CLIENT_ID,
      redirect_uri: `http://127.0.0.1:${lab.port}/callback`,
      state: authorization?.state,
      scope: 'read:jira-work write:jira-work read:jira-user offline_access',
      audience: 'api.atlassian.com',
      prompt: 'consent',
    });
    expect(authorization?.state.length).toBeGreaterThanOrEqual(32);

    // The code is exchanged with the client secret in a JSON body, and no PKCE verifier.
    expect(lab.auth.tokenRequests).toEqual([
      {
        grant_type: 'authorization_code',
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code: 'code-1',
        redirect_uri: authorization?.redirectUri,
      },
    ]);
    expect(lab.auth.fetch.calls[0]?.headers.get('content-type')).toBe('application/json');

    // Cloud id resolution, then the gateway: never the site.
    expect(
      lab.fetch.calls.map((call) => `${call.method} ${call.url.host}${call.url.pathname}`),
    ).toEqual([
      'POST auth.atlassian.com/oauth/token',
      'GET api.atlassian.com/oauth/token/accessible-resources',
      `GET api.atlassian.com${GATEWAY_PATH}/rest/api/3/myself`,
    ]);
    expect(lab.fetch.calls[1]?.headers.get('authorization')).toBe('Bearer access-1');
    expect(lab.siteCalls).toEqual([]);
  });

  it('keeps the tokens, the client secret and the cloud id in the keychain only', async () => {
    const run = await lab.login();

    expect(lab.store.accounts().sort()).toEqual([APP_ACCOUNT, CREDENTIAL_ACCOUNT]);
    expect(await loadStoredCredential(lab, TARGET)).toEqual({
      kind: 'oauth',
      accessToken: 'access-1',
      tokenType: 'bearer',
      refreshToken: 'refresh-1',
      expiresAt: TEST_NOW + HOUR,
      scope: 'read:jira-work write:jira-work read:jira-user offline_access',
    });
    expect(JSON.parse((await lab.store.get(APP_ACCOUNT)) ?? '')).toEqual({
      v: 1,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      cloudId: CLOUD_ID,
      callbackPort: lab.port,
    });
    expectNoSecrets(run);
  });

  it('reports the sign-in as JSON without any token or secret', async () => {
    const run = await lab.login(['--json']);
    expect(run.json()).toEqual({
      site: SITE,
      profile: 'default',
      kind: 'oauth',
      accountId: ME.accountId,
      displayName: ME.displayName,
      email: ME.emailAddress,
      expiresAt: new Date(TEST_NOW + HOUR).toISOString(),
      storage: 'keychain',
    });
    expectNoSecrets(run);
  });

  it('takes the client secret from a prompt that shows nothing', async () => {
    const run = await lab.login([], { stdin: { typed: CLIENT_SECRET } });
    expect(run.code).toBe(0);
    expect(run.stderr).toContain('Client secret: \n');
    expectNoSecrets(run);
  });

  it('takes the client secret from standard input with --client-secret-stdin', async () => {
    const run = await lab.login(['--client-secret-stdin'], { stdin: `${CLIENT_SECRET}\n` });
    expect(run.code).toBe(0);
    expect(lab.auth.tokenRequests[0]).toMatchObject({ client_secret: CLIENT_SECRET });
    expect(run.stderr).not.toContain('Client secret:');
    expectNoSecrets(run);
  });

  it('reads the client id and the callback port from the environment or the user file', async () => {
    const fromEnvironment = await lab.run(['auth', 'login', '--oauth'], {
      env: { SDLC_JIRA_CLIENT_ID: CLIENT_ID, SDLC_JIRA_CALLBACK_PORT: String(lab.port) },
    });
    expect(fromEnvironment.code, fromEnvironment.stderr).toBe(0);

    lab.files.set(
      USER_CONFIG,
      JSON.stringify({ jira: { clientId: CLIENT_ID, callbackPort: String(lab.port) } }),
    );
    const fromFile = await lab.run(['auth', 'login', '--oauth']);
    expect(fromFile.code, fromFile.stderr).toBe(0);
    expect(lab.auth.authorizations).toHaveLength(2);
  });

  it('keeps one sign-in per profile', async () => {
    await lab.login(['--profile', 'ops']);
    expect(lab.store.accounts().sort()).toEqual([
      `${APP_ACCOUNT}#ops`,
      `${CREDENTIAL_ACCOUNT}#ops`,
    ]);
  });

  it('picks the configured site among the sites that were allowed', async () => {
    lab.resources = [
      { id: 'other-cloud-id', name: 'other', url: 'https://other.example.test', scopes: [] },
      ...lab.resources,
    ];
    const run = await lab.login();
    expect(run.code, run.stderr).toBe(0);
    expect(lab.gateway.every((call) => call.url.pathname.startsWith(GATEWAY_PATH))).toBe(true);
  });
});

describe('auth login --oauth again', () => {
  const NEW_SECRET = 'regenerated-secret-value';
  const OTHER_APP = [
    'auth',
    'login',
    '--oauth',
    '--client-id',
    'another-app',
    '--callback-port',
  ] as const;

  it('reuses the stored client secret without asking for it', async () => {
    await lab.signIn();

    // Not a terminal and no flag: asking would fail with missing_client_secret.
    const piped = await lab.login([], { stdin: '' });
    expect(piped.code, piped.stderr).toBe(0);
    expect(piped.stderr).toContain('Using the client secret stored in the keychain.');
    expect(lab.auth.tokenRequests.at(-1)).toMatchObject({
      grant_type: 'authorization_code',
      client_secret: CLIENT_SECRET,
    });

    // A terminal is not prompted either, and what is typed there is never read.
    const typed = await lab.login([], { stdin: { typed: 'never-read-secret' } });
    expect(typed.code, typed.stderr).toBe(0);
    expect(typed.stderr).not.toContain('Client secret: ');
    expect(lab.auth.tokenRequests.at(-1)).toMatchObject({ client_secret: CLIENT_SECRET });

    for (const run of [piped, typed]) expectNoSecrets(run);
    expect(typed.stdout + typed.stderr).not.toContain('never-read-secret');
  });

  it('signs in again with no flags and no configuration, asking nothing', async () => {
    await lab.signIn();
    lab.fetch.calls.length = 0;

    const run = await lab.run(['auth', 'login', '--oauth'], { stdin: '' });

    expect(run.code, run.stderr).toBe(0);
    expect(run.stderr).not.toContain('Client secret:');
    expect(lab.auth.authorizations.at(-1)?.parameters).toMatchObject({
      client_id: CLIENT_ID,
      redirect_uri: `http://127.0.0.1:${lab.port}/callback`,
    });
    expect(lab.auth.tokenRequests.at(-1)).toMatchObject({ client_secret: CLIENT_SECRET });
    expectNoSecrets(run);
  });

  it.each([
    ['a flag', ['--callback-port'], {}, false],
    ['the environment', [], { SDLC_JIRA_CALLBACK_PORT: '' }, false],
    ['the user file', [], {}, true],
  ] as const)(
    'takes the callback port from %s before the stored one',
    async (_name, flag, env, file) => {
      await lab.signIn();
      const stored = JSON.parse((await lab.store.get(APP_ACCOUNT)) ?? '') as Record<
        string,
        unknown
      >;
      // A stored port nothing listens on: using it would never reach the callback.
      await lab.store.set(APP_ACCOUNT, JSON.stringify({ ...stored, callbackPort: 1 }));
      const port = String(lab.port);
      if (file) lab.files.set(USER_CONFIG, JSON.stringify({ jira: { callbackPort: port } }));

      const run = await lab.run(
        ['auth', 'login', '--oauth', ...flag.map((f) => [f, port]).flat()],
        {
          env: Object.fromEntries(Object.keys(env).map((key) => [key, port])),
          stdin: '',
        },
      );

      expect(run.code, run.stderr).toBe(0);
      expect(JSON.parse((await lab.store.get(APP_ACCOUNT)) ?? '')).toMatchObject({
        callbackPort: lab.port,
      });
    },
  );

  it('keeps the new port with the app for the sign-in after', async () => {
    await lab.signIn();
    const stored = JSON.parse((await lab.store.get(APP_ACCOUNT)) ?? '') as Record<string, unknown>;
    // An older record has no port.
    delete stored.callbackPort;
    await lab.store.set(APP_ACCOUNT, JSON.stringify(stored));

    const without = await lab.run(['auth', 'login', '--oauth'], { stdin: '' });
    expect(without.code).toBe(2);
    expect(without.stderr).toContain('Missing sign-in callback port.');
    expect(without.stderr).toContain('developer.atlassian.com');

    const withPort = await lab.run(
      ['auth', 'login', '--oauth', '--callback-port', String(lab.port)],
      {
        stdin: '',
      },
    );
    expect(withPort.code, withPort.stderr).toBe(0);
    expect(JSON.parse((await lab.store.get(APP_ACCOUNT)) ?? '')).toMatchObject({
      callbackPort: lab.port,
    });

    const again = await lab.run(['auth', 'login', '--oauth'], { stdin: '' });
    expect(again.code, again.stderr).toBe(0);
  });

  it('signs in again after the refresh token expired, without the secret', async () => {
    await lab.signIn();
    lab.now = TEST_NOW + 91 * 24 * HOUR;
    lab.auth.revokeRefreshTokens();
    expect((await lab.run(['issue', 'view', 'ABC-1'])).code).toBe(3);

    const again = await lab.login([], { stdin: '' });
    expect(again.code, again.stderr).toBe(0);
    expect((await lab.run(['issue', 'view', 'ABC-1', '--json'])).code).toBe(0);
  });

  it('asks for the secret when the configured client id is another app', async () => {
    await lab.signIn();
    const before = await lab.store.get(APP_ACCOUNT);
    const port = String(lab.port);

    // Without a terminal it cannot ask, so it fails before any request.
    lab.fetch.calls.length = 0;
    const piped = await lab.run([...OTHER_APP, port], { stdin: '' });
    expect(piped.code).toBe(2);
    expect(piped.stderr).toContain('Missing the client secret');
    expect(lab.fetch.calls).toHaveLength(0);

    // On a terminal it asks, and the answer, not the stored secret, goes to the token endpoint.
    const typed = await lab.run([...OTHER_APP, port], { stdin: { typed: 'another-secret' } });
    expect(typed.stderr).toContain('Client secret: ');
    expect(lab.auth.tokenRequests.at(-1)).toMatchObject({
      client_id: 'another-app',
      client_secret: 'another-secret',
    });
    expect(typed.stdout + typed.stderr).not.toContain('another-secret');
    // The fake server knows one app only, so this sign-in is refused and leaves what is stored alone.
    expect(typed.code).toBe(3);
    expect(await lab.store.get(APP_ACCOUNT)).toBe(before);
  });

  it('replaces the stored secret when --client-secret-stdin gives another', async () => {
    await lab.signIn();
    lab.auth.changeClientSecret(NEW_SECRET);

    const replaced = await lab.login(['--client-secret-stdin'], { stdin: `${NEW_SECRET}\n` });
    expect(replaced.code, replaced.stderr).toBe(0);
    expect(replaced.stderr).not.toContain('Using the client secret stored');
    expect(lab.auth.tokenRequests.at(-1)).toMatchObject({ client_secret: NEW_SECRET });
    expect(JSON.parse((await lab.store.get(APP_ACCOUNT)) ?? '')).toMatchObject({
      clientSecret: NEW_SECRET,
    });
    expect(replaced.stdout + replaced.stderr).not.toContain(NEW_SECRET);

    // Later sign-ins use the replacement.
    const later = await lab.login([], { stdin: '' });
    expect(later.code, later.stderr).toBe(0);
    expect(lab.auth.tokenRequests.at(-1)).toMatchObject({ client_secret: NEW_SECRET });
  });

  it('says how to enter a new secret when the stored one is refused', async () => {
    await lab.signIn();
    lab.auth.changeClientSecret(NEW_SECRET);

    const run = await lab.login(['--json'], { stdin: '' });

    expect(run.code).toBe(3);
    expect(errorOf(run)).toMatchObject({ code: 'oauth_invalid_client' });
    expect(String(errorOf(run).next)).toContain(
      'sdlc-jira auth login --oauth --client-secret-stdin',
    );
    expectNoSecrets(run);
    // Nothing is replaced until a new secret is given.
    expect(JSON.parse((await lab.store.get(APP_ACCOUNT)) ?? '')).toMatchObject({
      clientSecret: CLIENT_SECRET,
    });
  });

  it('keeps the secret of one profile apart from the other profiles', async () => {
    await lab.signIn();
    lab.fetch.calls.length = 0;
    const run = await lab.login(['--profile', 'ops'], { stdin: '' });
    expect(run.code).toBe(2);
    expect(run.stderr).toContain('Missing the client secret');
    expect(lab.fetch.calls).toHaveLength(0);
  });
});

describe('auth login --oauth fails locally', () => {
  it('names the developer console when there is no client id to be found anywhere', async () => {
    const run = await lab.run(['auth', 'login', '--oauth', '--callback-port', '8766']);

    expect(run.code).toBe(2);
    expect(run.stderr).toContain('Missing OAuth client id.');
    expect(run.stderr).toContain('developer.atlassian.com');
    expect(run.fetchCalls).toHaveLength(0);
  });

  const noRequest = (run: { fetchCalls: readonly unknown[]; stdout: string }) => {
    expect(run.fetchCalls).toHaveLength(0);
    expect(run.stdout).toBe('');
  };

  it.each([
    [
      'no client id',
      ['--callback-port', '8766'],
      ['Missing OAuth client id.', '--client-id', 'SDLC_JIRA_CLIENT_ID', '"clientId" under "jira"'],
    ],
    [
      'no callback port',
      ['--client-id', CLIENT_ID],
      [
        'Missing sign-in callback port.',
        '--callback-port',
        'SDLC_JIRA_CALLBACK_PORT',
        '"callbackPort" under "jira"',
      ],
    ],
  ])(
    'says what to set when there is %s, before the secret is asked for',
    async (_name, flags, expected) => {
      const run = await lab.run(['auth', 'login', '--oauth', ...flags]);

      expect(run.code).toBe(2);
      for (const text of expected) expect(run.stderr).toContain(text);
      expect(run.stderr).not.toContain('Client secret:');
      noRequest(run);
      expect(lab.store.accounts()).toEqual([]);
    },
  );

  it('does not let a repository file choose the app that receives the sign-in', async () => {
    lab.files
      .directory('/work/.git')
      .set(
        '/work/.sdlc-tools.json',
        JSON.stringify({ jira: { clientId: 'evil', callbackPort: '1' } }),
      );
    const run = await lab.run(['auth', 'login', '--oauth'], { cwd: '/work' });
    expect(run.code).toBe(2);
    expect(run.stderr).toContain('Missing OAuth client id.');
    noRequest(run);
  });

  it.each(['abc', '0', '70000', '80.5'])('refuses the callback port %s', async (port) => {
    const run = await lab.run([
      'auth',
      'login',
      '--oauth',
      '--client-id',
      CLIENT_ID,
      '--callback-port',
      port,
    ]);
    expect(run.code).toBe(2);
    expect(run.stderr).toContain('is not a valid port number');
    noRequest(run);
  });

  it('refuses a configuration file that holds a client secret', async () => {
    lab.files.set(
      USER_CONFIG,
      JSON.stringify({
        jira: { clientId: CLIENT_ID, callbackPort: String(lab.port), clientSecret: 'oops-secret' },
      }),
    );
    const run = await lab.run(['auth', 'login', '--oauth', '--json']);

    expect(run.code).toBe(2);
    expect(run.errorJson().error).toMatchObject({ code: 'secret_in_config' });
    expect(run.stderr).toContain('jira.clientSecret');
    expect(run.stderr).not.toContain('oops-secret');
    noRequest(run);
  });

  it('has no flag that would put the client secret on the command line', async () => {
    const run = await lab.login(['--client-secret', CLIENT_SECRET]);
    expect(run.code).toBe(2);
    expect(run.stderr).toContain('--client-secret');
    expect(run.stderr).not.toContain(CLIENT_SECRET);
    noRequest(run);
  });

  it('does not wait for a secret that standard input will not give', async () => {
    const run = await lab.login([], { stdin: CLIENT_SECRET });
    expect(run.code).toBe(2);
    expect(run.stderr).toContain('standard input is not a terminal');
    expect(run.stderr).toContain('--client-secret-stdin');
    noRequest(run);
  });

  it.each([
    ['nothing piped', '', 'Standard input was empty: the client secret is missing.'],
    ['nothing typed', { typed: '' }, 'Nothing was typed: the client secret is missing.'],
  ] as const)('refuses %s', async (_name, stdin, message) => {
    const flags = typeof stdin === 'string' ? ['--client-secret-stdin'] : [];
    const run = await lab.login(flags, { stdin });
    expect(run.code).toBe(2);
    expect(run.stderr).toContain(message);
    noRequest(run);
  });

  it('refuses a piped secret that is not one word, without repeating it', async () => {
    const run = await lab.login(['--client-secret-stdin', '--json'], { stdin: 'two words' });
    expect(run.errorJson().error).toMatchObject({ code: 'invalid_secret' });
    expect(run.stderr).not.toContain('two words');
    noRequest(run);
  });

  it.each([
    ['--email', ['--email', EMAIL]],
    ['--with-token', ['--with-token']],
  ])('does not mix --oauth with %s', async (flag, extra) => {
    const run = await lab.login(extra);
    expect(run.code).toBe(2);
    expect(run.stderr).toContain(`--oauth cannot be combined with ${flag}`);
    noRequest(run);
  });

  it.each([
    ['--client-id', ['--client-id', CLIENT_ID]],
    ['--callback-port', ['--callback-port', '8766']],
    ['--client-secret-stdin', ['--client-secret-stdin']],
  ])('does not accept %s without --oauth', async (flag, extra) => {
    const run = await lab.run(['auth', 'login', '--email', EMAIL, ...extra]);
    expect(run.code).toBe(2);
    expect(run.stderr).toContain(`${flag} can only be used with --oauth`);
    noRequest(run);
  });
});

describe('auth login --oauth fails without storing anything', () => {
  const stored = () => lab.store.accounts();

  it('names the sites that were allowed when the configured one is not among them', async () => {
    lab.resources = [
      { id: 'other-cloud-id', name: 'other', url: 'https://other.example.test', scopes: [] },
    ];
    const run = await lab.login(['--json']);

    expect(run.code).toBe(3);
    expect(errorOf(run)).toMatchObject({
      code: 'site_not_granted',
      details: { allowed: ['https://other.example.test'] },
    });
    expect(String(errorOf(run).message)).toContain('team.example.test');
    expect(String(errorOf(run).next)).toContain('select team.example.test');
    expect(lab.gateway).toHaveLength(0);
    expect(stored()).toEqual([]);
    expectNoSecrets(run);
  });

  it('says so when no site was allowed at all', async () => {
    lab.resources = [];
    const run = await lab.login();
    expect(run.code).toBe(3);
    expect(run.stderr).toContain('Atlassian reported no allowed site.');
    expect(stored()).toEqual([]);
  });

  it('reports a wrong client secret without repeating it', async () => {
    const run = await lab.login(['--json'], { stdin: { typed: 'the-wrong-secret' } });

    expect(run.code).toBe(3);
    expect(errorOf(run)).toMatchObject({ code: 'oauth_invalid_client' });
    // The person just typed it; the advice for a stored secret that went stale does not apply.
    expect(String(errorOf(run).next)).not.toContain('--client-secret-stdin');
    expect(run.stdout + run.stderr).not.toContain('the-wrong-secret');
    expect(run.stdout + run.stderr).not.toContain(CLIENT_SECRET);
    expect(stored()).toEqual([]);
  });

  it('stops when the person denies access in the browser', async () => {
    const run = await lab.login([], {
      openUrl: async (url) => {
        await lab.auth.approve(url, { code: null, error: 'access_denied' });
      },
    });
    expect(run.code).toBe(3);
    expect(run.stderr).toContain('access_denied');
    expect(lab.auth.tokenRequests).toHaveLength(0);
    expect(stored()).toEqual([]);
  });

  it('does not count a sign-in the gateway rejects', async () => {
    lab.rejected.add('access-1');
    const run = await lab.login();
    expect(run.code).toBe(3);
    expect(run.stderr).toContain('team.example.test rejected the credentials');
    expect(stored()).toEqual([]);
  });

  describe('when the browser never calls back', () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('names the callback URL the app has to register, while waiting and as the cause', async () => {
      const hint = `If the browser shows an error instead of the consent screen, the callback URL of the OAuth app is probably not exactly http://127.0.0.1:${lab.port}/callback.`;
      const run = await lab.login(['--json'], {
        // The listener is up and the timeout armed once the browser is asked to open.
        openUrl: () => {
          queueMicrotask(() => void vi.advanceTimersByTimeAsync(5 * 60_000));
          return Promise.resolve();
        },
      });

      expect(run.code).toBe(3);
      expect(run.stderr).toContain(`Waiting for the sign-in to finish...\n${hint}\n`);
      expect(errorOf(run)).toMatchObject({ code: 'login_timeout', causes: [hint] });
      expect(stored()).toEqual([]);
    });
  });
});

describe('API calls with an OAuth sign-in', () => {
  it('go through the gateway of the cloud id, never to the site', async () => {
    await lab.signIn();
    lab.gateway.length = 0;

    const run = await lab.run(['issue', 'view', 'ABC-1', '--json']);

    expect(run.code, run.stderr).toBe(0);
    expect(
      lab.gateway.map((call) => `${call.method} ${call.url.host}${call.url.pathname}`),
    ).toEqual([`GET api.atlassian.com${GATEWAY_PATH}/rest/api/3/issue/ABC-1`]);
    expect(lab.gateway[0]?.headers.get('authorization')).toBe('Bearer access-1');
    // Links to issues still point at the site people open in a browser.
    expect(run.json()).toMatchObject({ key: ISSUE.key, url: `${SITE}/browse/ABC-1` });
    expect(lab.siteCalls).toEqual([]);
    expectNoSecrets({ stdout: '', stderr: run.stderr });
  });

  it('name the site, not the gateway, when the API answers with an error', async () => {
    await lab.signIn();
    const run = await lab.run(['issue', 'view', 'ABC-404']);
    expect(run.code).toBe(5);
    expect(run.stderr).toContain('team.example.test could not find issue ABC-404');
    expect(run.stderr).not.toContain('api.atlassian.com');
  });

  it('are made with the API token instead when the environment provides one', async () => {
    await lab.signIn();
    const fetch = fakeJira({ 'GET /rest/api/3/issue/ABC-1': ISSUE });
    const run = await jira(['issue', 'view', 'ABC-1', '--json'], {
      env: ENV,
      store: lab.store,
      fetch,
    });
    expect(run.code).toBe(0);
    expect(fetch.calls[0]?.url.origin).toBe(SITE);
  });

  it('ask for a new sign-in when the stored one lost its client secret', async () => {
    await lab.signIn();
    await lab.store.delete(APP_ACCOUNT);
    lab.fetch.calls.length = 0;

    const run = await lab.run(['issue', 'view', 'ABC-1', '--json']);
    expect(run.code).toBe(3);
    expect(run.errorJson().error).toMatchObject({ code: 'oauth_app_missing' });
    expect(String(run.errorJson().error.next)).toContain('sdlc-jira auth login --oauth');
    expect(run.fetchCalls).toHaveLength(0);
  });

  it('treat an unreadable client secret record as missing', async () => {
    await lab.signIn();
    await lab.store.set(APP_ACCOUNT, 'not json');
    const run = await lab.run(['issue', 'view', 'ABC-1', '--json']);
    expect(run.errorJson().error).toMatchObject({ code: 'oauth_app_missing' });
  });

  it('point to both ways of signing in when there is no credential', async () => {
    const run = await lab.run(['issue', 'view', 'ABC-1']);
    expect(run.code).toBe(3);
    expect(run.stderr).toContain('sdlc-jira auth login --email <email>');
    expect(run.stderr).toContain('sdlc-jira auth login --oauth');
    expect(run.fetchCalls).toHaveLength(0);
  });
});

describe('renewing an OAuth sign-in', () => {
  const refreshes = () =>
    lab.auth.tokenRequests.filter((request) => request.grant_type === 'refresh_token');

  it('renews shortly before expiry and writes the rotated refresh token back', async () => {
    await lab.signIn();
    lab.now = TEST_NOW + HOUR - 30_000;

    const run = await lab.run(['issue', 'view', 'ABC-1', '--json']);

    expect(run.code, run.stderr).toBe(0);
    expect(refreshes()).toEqual([
      {
        grant_type: 'refresh_token',
        refresh_token: 'refresh-1',
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
      },
    ]);
    expect(lab.auth.fetch.calls.at(-1)?.headers.get('content-type')).toBe('application/json');
    expect(lab.gateway.at(-1)?.headers.get('authorization')).toBe('Bearer access-2');
    expect(await loadStoredCredential(lab, TARGET)).toMatchObject({
      accessToken: 'access-2',
      refreshToken: 'refresh-2',
      expiresAt: lab.now + HOUR,
    });
    expectNoSecrets({ stdout: '', stderr: run.stderr });

    // The next command finds a fresh token and does not renew again.
    await lab.run(['issue', 'view', 'ABC-1', '--json']);
    expect(refreshes()).toHaveLength(1);
    expect(lab.gateway.at(-1)?.headers.get('authorization')).toBe('Bearer access-2');
  });

  it('renews once after a 401 and repeats the request', async () => {
    await lab.signIn();
    lab.gateway.length = 0;
    lab.rejected.add('access-1');

    const run = await lab.run(['issue', 'view', 'ABC-1', '--json']);

    expect(run.code, run.stderr).toBe(0);
    expect(lab.gateway.map((call) => call.headers.get('authorization'))).toEqual([
      'Bearer access-1',
      'Bearer access-2',
    ]);
    expect(refreshes()).toHaveLength(1);
  });

  it('adopts a token that another process rotated in the meantime', async () => {
    await lab.signIn();
    lab.now = TEST_NOW + HOUR;
    lab.onTokenRequest = async () => {
      lab.onTokenRequest = undefined;
      lab.auth.revokeRefreshTokens();
      await saveCredential(lab, TARGET, {
        kind: 'oauth',
        accessToken: 'access-9',
        tokenType: 'bearer',
        refreshToken: 'refresh-9',
        expiresAt: lab.now + HOUR,
      });
    };

    const run = await lab.run(['issue', 'view', 'ABC-1', '--json']);

    expect(run.code, run.stderr).toBe(0);
    expect(lab.gateway.at(-1)?.headers.get('authorization')).toBe('Bearer access-9');
    expect(await loadStoredCredential(lab, TARGET)).toMatchObject({ refreshToken: 'refresh-9' });
  });

  it('tells you to sign in again once the refresh token has expired', async () => {
    await lab.signIn();
    const before = await lab.store.get(CREDENTIAL_ACCOUNT);
    lab.now = TEST_NOW + 91 * 24 * HOUR;
    lab.gateway.length = 0;
    // What Atlassian answers for a refresh token that is unknown, expired or already used.
    lab.auth.failNextTokenRequest(403, {
      error: 'invalid_grant',
      error_description: 'Unknown or invalid refresh token.',
    });

    const run = await lab.run(['issue', 'view', 'ABC-1', '--json']);

    expect(run.code).toBe(3);
    expect(run.errorJson().error).toMatchObject({
      kind: 'auth',
      code: 'refresh_failed',
      next: ['Sign in again with `sdlc-jira auth login --oauth`.'],
    });
    expect(lab.gateway).toHaveLength(0);
    expect(await lab.store.get(CREDENTIAL_ACCOUNT)).toBe(before);
    expectNoSecrets({ stdout: '', stderr: run.stderr });
  });
});

describe('auth status and logout with an OAuth sign-in', () => {
  it('shows the kind and when the access token expires', async () => {
    await lab.signIn();
    const text = await lab.run(['auth', 'status']);
    expect(text.stdout).toBe(
      `Signed in to team.example.test as Ada Lovelace with OAuth (client id ${CLIENT_ID}, access token valid until ${new Date(TEST_NOW + HOUR).toISOString()}, renewed automatically), credentials from the keychain.\n`,
    );

    const json = await lab.run(['auth', 'status', '--json']);
    expect(json.json()).toEqual({
      site: SITE,
      profile: 'default',
      kind: 'oauth',
      accountId: ME.accountId,
      displayName: ME.displayName,
      email: ME.emailAddress,
      source: 'keychain',
      clientId: CLIENT_ID,
      expiresAt: new Date(TEST_NOW + HOUR).toISOString(),
    });
    expectNoSecrets(json);
  });

  it('shows the expiry of the token it had to renew', async () => {
    await lab.signIn();
    lab.now = TEST_NOW + HOUR;
    const run = await lab.run(['auth', 'status', '--json']);
    expect(run.json()).toMatchObject({ expiresAt: new Date(TEST_NOW + 2 * HOUR).toISOString() });
  });

  it('removes the client secret together with the tokens on logout', async () => {
    await lab.signIn();
    const run = await lab.run(['auth', 'logout', '--json']);
    expect(run.json()).toMatchObject({ removed: true });
    expect(lab.store.accounts()).toEqual([]);

    const again = await lab.run(['auth', 'logout']);
    expect(again.stdout).toContain('No stored credentials');
  });

  it('leaves no client secret behind when an API token replaces the sign-in', async () => {
    await lab.signIn();
    const run = await jira(['auth', 'login', '--site', SITE, '--email', EMAIL], {
      env: { SDLC_JIRA_TOKEN: 'api-token-value' },
      fetch: fakeJira({ 'GET /rest/api/3/myself': ME }),
      store: lab.store,
    });
    expect(run.code, run.stderr).toBe(0);
    expect(lab.store.accounts()).toEqual([CREDENTIAL_ACCOUNT]);
    expect(await loadStoredCredential(lab, TARGET)).toMatchObject({ kind: 'token' });
  });
});
