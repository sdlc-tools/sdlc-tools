import { createServer } from 'node:net';
import {
  FakeAuthorizationServer,
  MemoryFiles,
  MemorySecretStore,
  TEST_NOW,
  execute,
  jsonResponse,
  mockFetch,
  type RecordedRequest,
  type TestRun,
  type TestRuntimeOptions,
} from '@sdlc-tools/core/testing';
import { expect } from 'vitest';
import { cli } from '../src/index.js';
import { ISSUE, SITE } from './helpers.js';

export const CLOUD_ID = '11223344-a1b2-3b33-c444-def123456789';
export const CLIENT_ID = 'app-client-id';
export const CLIENT_SECRET = 'app-client-secret-value';
export const GATEWAY_PATH = `/ex/jira/${CLOUD_ID}`;
export const USER_CONFIG = '/home/test/.config/sdlc-tools/config.json';

export const ME = {
  accountId: '5b10a2844c20165700ede21f',
  displayName: 'Ada Lovelace',
  emailAddress: 'ada@example.test',
};

interface Resource {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly scopes: readonly string[];
}

const ACCESS_TOKEN = /^Bearer access-\d+$/;

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      probe.close(() => {
        resolve(port);
      });
    });
  });
}

/**
 * Atlassian Cloud in memory: the authorization server at `auth.atlassian.com` (a confidential
 * client, JSON token requests, no PKCE), the list of sites the person allowed, and the Jira API
 * gateway. A request to the site itself fails the run, since an OAuth sign-in must never use it.
 */
export class AtlassianLab {
  readonly auth = new FakeAuthorizationServer({
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    tokenRequestFormat: 'json',
    authorizationEndpoint: 'https://auth.atlassian.com/authorize',
    tokenEndpoint: 'https://auth.atlassian.com/oauth/token',
  });
  readonly store = new MemorySecretStore();
  readonly files = new MemoryFiles();
  /** Every request to the Jira gateway, including the ones refused. */
  readonly gateway: RecordedRequest[] = [];
  /** Access tokens the gateway refuses with 401. */
  readonly rejected = new Set<string>();
  resources: Resource[] = [
    { id: CLOUD_ID, name: 'team', url: SITE, scopes: ['read:jira-work', 'write:jira-work'] },
  ];
  now = TEST_NOW;
  /** Runs when the token endpoint is called, before it answers. */
  onTokenRequest: (() => Promise<void>) | undefined;

  readonly fetch = mockFetch(async (request) => {
    const { host, pathname } = request.url;
    if (host === 'auth.atlassian.com') {
      await this.onTokenRequest?.();
      return this.auth.fetch.fetch(request.url.href, {
        method: request.method,
        headers: request.headers,
        ...(request.body === undefined ? {} : { body: request.body }),
      });
    }
    if (host !== 'api.atlassian.com') {
      throw new Error(`AtlassianLab: unexpected request to ${request.url.href}`);
    }
    const bearer = request.headers.get('authorization') ?? '';
    if (pathname === '/oauth/token/accessible-resources') {
      return ACCESS_TOKEN.test(bearer)
        ? jsonResponse(200, this.resources)
        : jsonResponse(401, { message: 'Unauthorized' });
    }
    if (pathname.startsWith(GATEWAY_PATH)) {
      this.gateway.push(request);
      const token = bearer.replace('Bearer ', '');
      if (!ACCESS_TOKEN.test(bearer) || this.rejected.has(token)) {
        return jsonResponse(401, { message: 'Unauthorized' });
      }
      return this.route(`${request.method} ${pathname.slice(GATEWAY_PATH.length)}`);
    }
    return jsonResponse(404, { message: 'not found' });
  });

  private constructor(readonly port: number) {}

  static async create(): Promise<AtlassianLab> {
    return new AtlassianLab(await freePort());
  }

  private route(key: string): Response {
    if (key === 'GET /rest/api/3/myself') return jsonResponse(200, ME);
    if (key === 'GET /rest/api/3/issue/ABC-1') return jsonResponse(200, ISSUE);
    return jsonResponse(404, {
      errorMessages: ['Issue does not exist or you do not have permission.'],
    });
  }

  /** The requests that went to the site itself rather than the gateway. */
  get siteCalls(): RecordedRequest[] {
    return this.fetch.calls.filter((call) => call.url.host === new URL(SITE).host);
  }

  run(
    argv: readonly string[],
    options: Pick<TestRuntimeOptions, 'env' | 'stdin' | 'openUrl' | 'cwd'> = {},
  ): Promise<TestRun> {
    return execute(cli, argv, {
      fetch: this.fetch,
      store: this.store,
      files: this.files,
      env: { SDLC_JIRA_SITE: SITE, ...options.env },
      now: () => this.now,
      openUrl: options.openUrl ?? this.auth.openUrl,
      stdin: options.stdin ?? { typed: CLIENT_SECRET },
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    });
  }

  /** `auth login --oauth` with the app's id and this lab's callback port. */
  login(
    extra: readonly string[] = [],
    options: Parameters<AtlassianLab['run']>[1] = {},
  ): Promise<TestRun> {
    return this.run(
      [
        'auth',
        'login',
        '--oauth',
        '--client-id',
        CLIENT_ID,
        '--callback-port',
        String(this.port),
        ...extra,
      ],
      options,
    );
  }

  /** Signs in, failing the test if that does not work. */
  async signIn(): Promise<void> {
    const run = await this.login();
    expect(run.code, run.stderr).toBe(0);
  }
}

/** Neither the client secret nor any issued token may reach what a command prints. */
export function expectNoSecrets(run: { stdout: string; stderr: string }): void {
  const printed = run.stdout + run.stderr;
  expect(printed).not.toContain(CLIENT_SECRET);
  expect(printed).not.toMatch(/\b(access|refresh)-\d+\b/);
}

/** The error document of a failed sign-in: the last line of stderr, after the progress lines before it. */
export function errorOf(run: Pick<TestRun, 'stderr'>): Record<string, unknown> {
  const lines = run.stderr.trimEnd().split('\n');
  return (JSON.parse(lines.at(-1) ?? '') as { error: Record<string, unknown> }).error;
}
