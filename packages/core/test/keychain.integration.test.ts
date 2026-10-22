import { randomBytes } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { KeychainSecretStore, parseCredential, serializeCredential } from '../src/index.js';

/**
 * Exercises the real operating system credential store. Opt in with
 * SDLC_TEST_KEYCHAIN=1; the keychain workflow runs it on macOS, Windows and Linux.
 * Every item lives under a throwaway service name and is removed afterwards.
 */
describe.skipIf(process.env.SDLC_TEST_KEYCHAIN !== '1')('OS keychain', () => {
  const service = `sdlc-tools-test-${randomBytes(6).toString('hex')}`;
  const store = new KeychainSecretStore({ service, platform: process.platform });
  const accounts = new Set<string>();

  function account(name: string): string {
    const full = `test:${name}`;
    accounts.add(full);
    return full;
  }

  afterAll(async () => {
    for (const name of accounts) await store.delete(name);
  });

  it('stores, reads and deletes a secret', async () => {
    const name = account('roundtrip');
    expect(await store.get(name)).toBeNull();
    await store.set(name, 'secret-value');
    expect(await store.get(name)).toBe('secret-value');
    expect(await store.delete(name)).toBe(true);
    expect(await store.get(name)).toBeNull();
    expect(await store.delete(name)).toBe(false);
  });

  it('overwrites an existing secret', async () => {
    const name = account('overwrite');
    await store.set(name, 'first');
    await store.set(name, 'second');
    expect(await store.get(name)).toBe('second');
  });

  it('keeps non-ASCII text intact', async () => {
    const name = account('unicode');
    const value = 'pässwörd-密码-🔑';
    await store.set(name, value);
    expect(await store.get(name)).toBe(value);
  });

  it('stores an OAuth credential larger than a single keychain item allows', async () => {
    const name = account('large');
    const credential = {
      kind: 'oauth',
      accessToken: randomBytes(900).toString('base64url'),
      refreshToken: randomBytes(900).toString('base64url'),
      tokenType: 'bearer',
      expiresAt: 1_800_000_000_000,
    } as const;
    await store.set(name, serializeCredential(credential));
    expect(parseCredential((await store.get(name)) ?? '')).toEqual(credential);

    await store.set(name, serializeCredential({ kind: 'token', token: 'short' }));
    expect(parseCredential((await store.get(name)) ?? '')).toEqual({
      kind: 'token',
      token: 'short',
    });
    expect(await store.delete(name)).toBe(true);
  });
});
