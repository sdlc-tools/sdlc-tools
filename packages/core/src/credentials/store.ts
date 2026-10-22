/**
 * Storage for secrets, keyed by an account string (see `credentialAccount`).
 * Implementations never log or echo values.
 */
export interface SecretStore {
  get(account: string): Promise<string | null>;
  set(account: string, value: string): Promise<void>;
  /** Resolves `true` when something was removed, `false` when nothing was stored. */
  delete(account: string): Promise<boolean>;
}
