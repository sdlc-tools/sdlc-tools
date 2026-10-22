import type { SecretStore } from '../credentials/store.js';

/** An in-memory {@link SecretStore} for tests; nothing touches the OS keychain. */
export class MemorySecretStore implements SecretStore {
  readonly #values = new Map<string, string>();

  get(account: string): Promise<string | null> {
    return Promise.resolve(this.#values.get(account) ?? null);
  }

  set(account: string, value: string): Promise<void> {
    this.#values.set(account, value);
    return Promise.resolve();
  }

  delete(account: string): Promise<boolean> {
    return Promise.resolve(this.#values.delete(account));
  }

  /** Account names currently stored, for assertions. */
  accounts(): string[] {
    return [...this.#values.keys()];
  }
}
