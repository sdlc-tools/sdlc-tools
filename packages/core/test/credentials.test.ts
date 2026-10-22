import { describe, expect, it, vi } from 'vitest';
import {
  CliError,
  KeychainSecretStore,
  basicAuth,
  bearerAuth,
  credentialAccount,
  deleteCredential,
  loadStoredCredential,
  parseCredential,
  resolveCredential,
  saveCredential,
  serializeCredential,
  toolEnvVar,
  type KeyringBinding,
  type StoredCredential,
} from '../src/index.js';
import { MemorySecretStore } from '../src/testing/index.js';

const ORIGIN = 'https://git.example.test';
const TARGET = { tool: 'forgejo', origin: ORIGIN } as const;

async function rejection(promise: Promise<unknown>): Promise<CliError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(CliError);
    return error as CliError;
  }
  throw new Error('expected a rejection');
}

describe('credentialAccount', () => {
  it('binds tool and origin, and appends non-default profiles', () => {
    expect(credentialAccount(TARGET)).toBe('forgejo:https://git.example.test');
    expect(credentialAccount({ ...TARGET, profile: 'default' })).toBe(
      'forgejo:https://git.example.test',
    );
    expect(credentialAccount({ ...TARGET, profile: 'work' })).toBe(
      'forgejo:https://git.example.test#work',
    );
  });

  it('rejects names that could collide with the chunk or profile separators', () => {
    expect(() => credentialAccount({ ...TARGET, profile: 'a~1' })).toThrow(/Invalid profile/);
    expect(() => credentialAccount({ ...TARGET, profile: 'a#b' })).toThrow(/Invalid profile/);
    expect(() => credentialAccount({ tool: 'Bad Tool', origin: ORIGIN })).toThrow(/Invalid tool/);
  });

  it('derives environment variable names from the tool', () => {
    expect(toolEnvVar('forgejo', 'token')).toBe('SDLC_FORGEJO_TOKEN');
    expect(toolEnvVar('my-tool', 'host')).toBe('SDLC_MY_TOOL_HOST');
  });
});

describe('stored credential format', () => {
  const credentials: StoredCredential[] = [
    { kind: 'token', token: 't0ken' },
    { kind: 'token', token: 't0ken', username: 'me@example.test' },
    { kind: 'oauth', accessToken: 'a', tokenType: 'bearer' },
    {
      kind: 'oauth',
      accessToken: 'a',
      tokenType: 'bearer',
      refreshToken: 'r',
      expiresAt: 1_800_000_000_000,
      scope: 'read write',
    },
  ];

  it.each(credentials)('round-trips %j', (credential) => {
    expect(parseCredential(serializeCredential(credential))).toEqual(credential);
  });

  it.each([
    'not json',
    '"string"',
    '{"v":2,"kind":"token","token":"x"}',
    '{"v":1,"kind":"token"}',
    '{"v":1,"kind":"token","token":""}',
    '{"v":1,"kind":"token","token":"x","username":5}',
    '{"v":1,"kind":"oauth","accessToken":"a"}',
    '{"v":1,"kind":"oauth","accessToken":"a","tokenType":"b","expiresAt":"soon"}',
    '{"v":1,"kind":"other"}',
  ])('rejects %s', (text) => {
    expect(parseCredential(text)).toBeUndefined();
  });
});

describe('resolveCredential', () => {
  const options = {
    ...TARGET,
    tokenEnv: 'SDLC_FORGEJO_TOKEN',
    usernameEnv: 'SDLC_FORGEJO_USER',
    loginCommand: 'sdlc-forgejo auth login',
  };

  it('prefers the environment variable and never reads the keychain', async () => {
    const store = new MemorySecretStore();
    const get = vi.spyOn(store, 'get');
    const resolved = await resolveCredential(
      { env: { SDLC_FORGEJO_TOKEN: 'from-env', SDLC_FORGEJO_USER: 'me' }, store },
      options,
    );
    expect(resolved).toEqual({
      credential: { kind: 'token', token: 'from-env', username: 'me' },
      source: 'env',
      account: 'forgejo:https://git.example.test',
    });
    expect(get).not.toHaveBeenCalled();
  });

  it('falls back to the keychain item for this origin', async () => {
    const store = new MemorySecretStore();
    await saveCredential({ store }, TARGET, { kind: 'token', token: 'stored' });
    const resolved = await resolveCredential({ env: {}, store }, options);
    expect(resolved.source).toBe('keychain');
    expect(resolved.credential).toEqual({ kind: 'token', token: 'stored' });
  });

  it('keeps credentials of different origins and profiles apart', async () => {
    const store = new MemorySecretStore();
    await saveCredential({ store }, TARGET, { kind: 'token', token: 'one' });
    await saveCredential(
      { store },
      { ...TARGET, profile: 'work' },
      { kind: 'token', token: 'two' },
    );

    const other = await rejection(
      resolveCredential({ env: {}, store }, { ...options, origin: 'https://other.example.test' }),
    );
    expect(other.code).toBe('no_credentials');
    expect(
      (await resolveCredential({ env: {}, store }, { ...options, profile: 'work' })).credential,
    ).toEqual({
      kind: 'token',
      token: 'two',
    });
  });

  it('fails with an auth error and next steps when nothing is stored', async () => {
    const error = await rejection(
      resolveCredential({ env: {}, store: new MemorySecretStore() }, options),
    );
    expect(error.kind).toBe('auth');
    expect(error.exitCode).toBe(3);
    expect(error.code).toBe('no_credentials');
    expect(error.message).toContain(ORIGIN);
    expect(error.next).toEqual([
      'Sign in with `sdlc-forgejo auth login`.',
      'Or set the SDLC_FORGEJO_TOKEN environment variable.',
    ]);
  });

  it('reports an unreadable stored value as a credential problem', async () => {
    const store = new MemorySecretStore();
    await store.set(credentialAccount(TARGET), 'garbage');
    const error = await rejection(resolveCredential({ env: {}, store }, options));
    expect(error.code).toBe('credential_corrupt');
    expect(error.exitCode).toBe(3);
  });

  it('suggests the environment variable when the keychain is unavailable', async () => {
    const store = new MemorySecretStore();
    vi.spyOn(store, 'get').mockRejectedValue(
      new CliError('auth', 'The OS keychain is not available: no daemon', {
        code: 'keychain_unavailable',
      }),
    );
    const error = await rejection(resolveCredential({ env: {}, store }, options));
    expect(error.code).toBe('keychain_unavailable');
    expect(error.next).toContain('Set SDLC_FORGEJO_TOKEN to provide a token without the keychain.');
  });

  it('saves, loads and deletes through the store', async () => {
    const store = new MemorySecretStore();
    const credential: StoredCredential = { kind: 'oauth', accessToken: 'a', tokenType: 'bearer' };
    await saveCredential({ store }, TARGET, credential);
    expect(await loadStoredCredential({ store }, TARGET)).toEqual(credential);
    expect(await deleteCredential({ store }, TARGET)).toBe(true);
    expect(await deleteCredential({ store }, TARGET)).toBe(false);
    expect(await loadStoredCredential({ store }, TARGET)).toBeUndefined();
  });
});

describe('auth header builders', () => {
  it('builds Bearer and Basic headers', async () => {
    expect(await bearerAuth('abc').authorization()).toBe('Bearer abc');
    expect(await basicAuth('me@example.test', 'api-token').authorization()).toBe(
      `Basic ${Buffer.from('me@example.test:api-token').toString('base64')}`,
    );
  });
});

/** An in-memory keyring that, like Windows Credential Manager, rejects values over a size limit. */
function fakeBinding(options: { maxLength?: number; failWith?: Error } = {}) {
  const items = new Map<string, string>();
  const binding: KeyringBinding = {
    AsyncEntry: class {
      constructor(
        readonly service: string,
        readonly username: string,
      ) {}
      private key(): string {
        return `${this.service}/${this.username}`;
      }
      getPassword(): Promise<string | null> {
        if (options.failWith) return Promise.reject(options.failWith);
        return Promise.resolve(items.get(this.key()) ?? null);
      }
      setPassword(password: string): Promise<void> {
        if (options.failWith) return Promise.reject(options.failWith);
        if (options.maxLength !== undefined && password.length > options.maxLength) {
          return Promise.reject(new Error('blob too large'));
        }
        items.set(this.key(), password);
        return Promise.resolve();
      }
      deletePassword(): Promise<boolean> {
        return Promise.resolve(items.delete(this.key()));
      }
    },
  };
  return { binding, items };
}

describe('KeychainSecretStore', () => {
  function store(
    binding: KeyringBinding,
    extra: Partial<ConstructorParameters<typeof KeychainSecretStore>[0]> = {},
  ) {
    return new KeychainSecretStore({
      service: 'test-service',
      platform: 'linux',
      loadBinding: () => Promise.resolve(binding),
      ...extra,
    });
  }

  it('round-trips a short value in a single item', async () => {
    const { binding, items } = fakeBinding();
    const keychain = store(binding);
    await keychain.set('acct', 'secret');
    expect(await keychain.get('acct')).toBe('secret');
    expect([...items.keys()]).toEqual(['test-service/acct']);
    expect(await keychain.get('missing')).toBeNull();
  });

  it('splits long values across items and reassembles them', async () => {
    const { binding, items } = fakeBinding();
    const keychain = store(binding, { chunkSize: 8 });
    const value = 'abcdefghijklmnopqrstuvwxyz';
    await keychain.set('acct', value);
    expect(items.size).toBe(4);
    expect(await keychain.get('acct')).toBe(value);
  });

  it('keeps every item within a backend size limit that a whole credential exceeds', async () => {
    const { binding } = fakeBinding({ maxLength: 1280 + 10 });
    const keychain = store(binding);
    const credential: StoredCredential = {
      kind: 'oauth',
      accessToken: 'a'.repeat(1500),
      refreshToken: 'r'.repeat(1500),
      tokenType: 'bearer',
    };
    await keychain.set('acct', serializeCredential(credential));
    expect(parseCredential((await keychain.get('acct')) ?? '')).toEqual(credential);
  });

  it('does not split a surrogate pair', async () => {
    const { binding, items } = fakeBinding();
    const keychain = store(binding, { chunkSize: 3 });
    const value = 'ab😀cd😀';
    await keychain.set('acct', value);
    for (const item of items.values()) {
      expect(item.replace(/^sdlc1:\d+:/, '')).not.toMatch(/[\uD800-\uDBFF]$|^[\uDC00-\uDFFF]/);
    }
    expect(await keychain.get('acct')).toBe(value);
  });

  it('removes leftover chunks when a value shrinks', async () => {
    const { binding, items } = fakeBinding();
    const keychain = store(binding, { chunkSize: 4 });
    await keychain.set('acct', 'x'.repeat(20));
    expect(items.size).toBe(5);
    await keychain.set('acct', 'short');
    expect(items.size).toBe(2);
    expect(await keychain.get('acct')).toBe('short');
  });

  it('deletes every chunk and reports whether anything existed', async () => {
    const { binding, items } = fakeBinding();
    const keychain = store(binding, { chunkSize: 4 });
    await keychain.set('acct', 'x'.repeat(20));
    expect(await keychain.delete('acct')).toBe(true);
    expect(items.size).toBe(0);
    expect(await keychain.delete('acct')).toBe(false);
  });

  it('reports a missing chunk as a corrupt credential', async () => {
    const { binding, items } = fakeBinding();
    const keychain = store(binding, { chunkSize: 4 });
    await keychain.set('acct', 'x'.repeat(20));
    items.delete('test-service/acct~2');
    const error = await rejection(keychain.get('acct'));
    expect(error.code).toBe('credential_corrupt');
    expect(error.exitCode).toBe(3);
  });

  it('reports an item it did not write as corrupt', async () => {
    const { binding, items } = fakeBinding();
    items.set('test-service/acct', 'written by someone else');
    expect((await rejection(store(binding).get('acct'))).code).toBe('credential_corrupt');
  });

  it('passes a pinned Linux store to the native entry, and nothing by default', async () => {
    const seen: unknown[] = [];
    const binding: KeyringBinding = {
      AsyncEntry: class {
        constructor(_service: string, _username: string, options?: unknown) {
          seen.push(options);
        }
        getPassword = () => Promise.resolve(null);
        setPassword = () => Promise.resolve();
        deletePassword = () => Promise.resolve(false);
      },
    };
    await store(binding).get('a');
    await store(binding, { linuxStore: 'keyutils' }).get('a');
    expect(seen).toEqual([undefined, { linux: { store: 'keyutils' } }]);
  });

  it('loads the native binding lazily and once', async () => {
    const { binding } = fakeBinding();
    const loadBinding = vi.fn(() => Promise.resolve(binding));
    const keychain = new KeychainSecretStore({ platform: 'linux', loadBinding });
    expect(loadBinding).not.toHaveBeenCalled();
    await keychain.set('a', '1');
    await keychain.get('a');
    expect(loadBinding).toHaveBeenCalledTimes(1);
  });

  it('turns a missing binding into a keychain-unavailable auth error', async () => {
    const keychain = new KeychainSecretStore({
      platform: 'linux',
      loadBinding: () => Promise.reject(new Error('Cannot find module')),
    });
    const error = await rejection(keychain.get('a'));
    expect(error.kind).toBe('auth');
    expect(error.exitCode).toBe(3);
    expect(error.code).toBe('keychain_unavailable');
    expect(error.message).toContain('Cannot find module');
    expect(error.next.join(' ')).toMatch(/environment variable/);
  });

  it.each([
    ['linux', /Secret Service/],
    ['darwin', /login keychain/],
    ['win32', /Credential Manager/],
  ] as const)('explains likely causes on %s', async (platform, pattern) => {
    const { binding } = fakeBinding({ failWith: new Error('boom') });
    const error = await rejection(store(binding, { platform }).get('a'));
    expect(error.causes.join(' ')).toMatch(pattern);
  });
});
