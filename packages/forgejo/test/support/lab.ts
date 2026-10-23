import { saveCredential } from '@sdlc-tools/core';
import {
  FakeAuthorizationServer,
  MemorySecretStore,
  TEST_NOW,
  execute,
  mockFetch,
  type TestRun,
} from '@sdlc-tools/core/testing';
import { createCli, type Ports } from '../../src/index.js';
import { FakeForgejo, HOST } from './fake-forgejo.js';
import { FakeGit } from './fake-git.js';

export interface RunOptions {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly cwd?: string;
  readonly openUrl?: (url: string) => Promise<void>;
  readonly signal?: AbortSignal;
}

/** One server, one OAuth provider, one checkout and one keychain, wired to the real command tree. */
export class Lab {
  readonly forgejo = new FakeForgejo();
  readonly oauth = new FakeAuthorizationServer();
  readonly git = new FakeGit();
  readonly store = new MemorySecretStore();
  readonly files = new Map<string, string>();
  stdin = '';
  now = TEST_NOW;

  readonly fetch = mockFetch((request) => {
    if (request.url.pathname.startsWith('/api/v1')) return this.forgejo.handle(request);
    return this.oauth.fetch.fetch(request.url.href, {
      method: request.method,
      headers: request.headers,
      ...(request.body === undefined ? {} : { body: request.body }),
    });
  });

  readonly ports: Ports = {
    git: this.git,
    readTextFile: (path) => {
      const text = this.files.get(path);
      return text === undefined
        ? Promise.reject(new Error(`ENOENT: ${path}`))
        : Promise.resolve(text);
    },
  };

  readonly cli = createCli({ version: '1.2.3', ports: this.ports });

  constructor() {
    // The access tokens the fake OAuth provider hands out in turn.
    for (let issued = 1; issued <= 9; issued += 1) {
      this.forgejo.acceptToken(`access-${issued}`, 'alice');
    }
  }

  /** Stores a personal access token the way `auth login --with-token` would. */
  async signInWithToken(token = 'pat-1'): Promise<void> {
    await saveCredential(
      { store: this.store },
      { tool: 'forgejo', origin: new URL(HOST).origin },
      { kind: 'token', token },
    );
  }

  /** Signs in through the full OAuth flow against the fake provider. */
  async signInWithOAuth(): Promise<void> {
    const login = await this.run(['auth', 'login', '--client-id', this.oauth.client.clientId]);
    if (login.code !== 0) throw new Error(`sign-in failed: ${login.stderr}`);
  }

  run(argv: readonly string[], options: RunOptions = {}): Promise<TestRun> {
    return execute(this.cli, argv, {
      fetch: this.fetch,
      store: this.store,
      env: { SDLC_FORGEJO_HOST: HOST, ...options.env },
      cwd: options.cwd ?? '/work',
      now: () => this.now,
      openUrl: options.openUrl ?? this.oauth.openUrl,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      stdin: this.stdin,
    });
  }
}
